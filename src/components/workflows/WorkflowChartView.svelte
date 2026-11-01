<!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { onMount, untrack, tick } from "svelte";
  import { init, use, format as chartFormat } from "echarts/core";
  import { LineChart, BarChart, ScatterChart, PieChart, SankeyChart } from "echarts/charts";
  import { AriaComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from "echarts/components";
  import { SVGRenderer } from "echarts/renderers";
  import { LabelLayout } from "echarts/features";
  import type { EChartsOption } from "echarts";
  import { chartPalette, chartNamedStyles, chartSeriesName, tableBooleanStyles } from "$lib/workflow-chart-presentation.ts";
  import { tableColumnFormats } from "$lib/workflow-table.ts";
  import { chartConfigurationKey, type ChartData, type ChartSnapshot } from "$lib/workflow-chart.ts";
  import { chartDecal } from "$lib/chart-settings.ts";
  import { chartSettingsState } from "$lib/chart-settings-state.ts";
  import { createChartInspection, zoomChartRange, chartGridLayout, chartPlotBounds, chartSelection, chartLegendLayout, sankeyHighlights, sankeyNodeKey, sankeyLinkKey, type ChartInspection, type ChartPoint } from "$lib/workflow-chart-interaction.ts";

  use([LineChart, BarChart, ScatterChart, PieChart, SankeyChart, AriaComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, SVGRenderer, LabelLayout]);
  let { data, snapshot, inspection = createChartInspection() }: { data: ChartData; snapshot?: ChartSnapshot | undefined; inspection?: ChartInspection } = $props();
  let host = $state<HTMLDivElement>();
  let viewHost = $state<HTMLDivElement>();
  let chart = $state.raw<ReturnType<typeof init>>();
  let chartSize = $state.raw({ width: 0, height: 0 });
  let paletteRevision = $state(0);
  let themeError = $state("");
  const axisNumbers = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 });
  let page = $state(untrack(() => inspection.page));
  let filter = $state(untrack(() => inspection.filter));
  let paused = $state(untrack(() => inspection.paused));
  let frozen = $state.raw<ChartSnapshot | undefined>(untrack(() => inspection.frozen));
  let scale = $state(untrack(() => inspection.scale));
  let sankeySelection = $state.raw<string[]>(untrack(() => [...inspection.sankeySelection]));
  const cartesian = $derived(["line", "bar", "area", "scatter"].includes(data.kind));
  let zoomLevel = $state(untrack(() => ["pie", "sankey"].includes(data.kind) ? Math.round(inspection.scale * 100) : Math.round(10000 / Math.min(inspection.x.end - inspection.x.start, inspection.y.end - inspection.y.start))));
  let selection = $state.raw<{ pointerId: number; start: ChartPoint; end: ChartPoint; axisOnly: boolean } | null>(null);
  const shown = $derived(paused ? frozen : snapshot);
  const current = $derived(shown?.configuration === chartConfigurationKey(data) ? shown : undefined);
  const series = $derived(current?.series ?? []);
  const legendNames = $derived(data.kind === "pie" ? (series[0]?.points ?? []).filter(point => point.y !== null).map(point => String(point.x))
    : cartesian && series.length > 1 ? series.map(item => chartSeriesName(data, item)) : []);
  const legendLayout = $derived.by(() => {
    paletteRevision;
    const fontSize = 12 * (cartesian ? 1 : scale), family = host ? getComputedStyle(host).fontFamily : "sans-serif";
    return chartLegendLayout(legendNames, chartSize.width, chartSize.height, fontSize, name => chartFormat.getTextRect(name, `${fontSize}px ${family}`).width);
  });
  const selectionBox = $derived(selection && chart ? chartSelection(selection.start, selection.end, chartPlotBounds(chart.getWidth(), chart.getHeight(), series.length > 1, legendLayout.height), selection.axisOnly) : undefined);
  const points = $derived(series.reduce((count, series) => count + series.points.length, 0));
  const count = $derived(data.kind === "table" ? current?.rows.length ?? 0 : data.kind === "sankey" ? current?.links.length ?? 0 : points);
  const positiveSlices = $derived(series[0]?.points.some(point => point.y !== null && point.y > 0));
  const visible = $derived(!!count && !current?.error && (data.kind !== "sankey" || !!current?.nodes.length) && (data.kind !== "pie" || !!positiveSlices));
  const tableFormats = $derived(current ? tableColumnFormats(current) : []);
  const booleanStyles = $derived.by(() => {
    paletteRevision;
    return data.kind === "table" && viewHost ? tableBooleanStyles(chartPalette(getComputedStyle(viewHost))) : undefined;
  });
  const rows = $derived(current?.rows.filter(row => !filter.trim() || row.some((value, index) =>
    [value, tableFormats[index]!.format(value)].some(text => text.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())))) ?? []);
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 50)));
  const currentPage = $derived(Math.min(page, pages - 1));
  const message = $derived(current?.error ?? (themeError || (current ? data.kind === "pie" && !positiveSlices ? "No positive slice values to display." : "No displayable data in the connected inputs." : "Waiting for connected workflow data…")));

  function zoomBy(factor: number) {
    if (!cartesian) { scale = Math.max(1, Math.min(4, scale * factor)); inspection.scale = scale; zoomLevel = Math.round(scale * 100); return; }
    inspection.x = zoomChartRange(inspection.x, factor);
    inspection.y = zoomChartRange(inspection.y, factor);
    chart?.dispatchAction({ type: "dataZoom", batch: [{ dataZoomId: "x-slider", ...inspection.x },
      { dataZoomId: "y-inside", ...inspection.y }] });
    updateZoomLevel();
  }
  function resetView() {
    inspection.x = { start: 0, end: 100 }; inspection.y = { start: 0, end: 100 };
    inspection.scale = 1; scale = 1; zoomLevel = 100; inspection.selected = {}; inspection.legendScroll = 0;
    clearHighlights();
    chart?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    chart?.dispatchAction({ type: "legendAllSelect" });
    chart?.dispatchAction({ type: "legendScroll", scrollDataIndex: 0 });
  }
  function clearHighlights() { sankeySelection = []; inspection.sankeySelection = sankeySelection; }
  function toggleSankeyHighlight(event: unknown) {
    const hit = event as { seriesType?: string; dataType?: string; data?: { name?: unknown; source?: unknown; target?: unknown } };
    if (data.kind !== "sankey" || hit.seriesType !== "sankey" || !hit.data) return;
    const key = hit.dataType === "edge" && typeof hit.data.source === "string" && typeof hit.data.target === "string"
      ? sankeyLinkKey(hit.data.source, hit.data.target) : typeof hit.data.name === "string" ? sankeyNodeKey(hit.data.name) : undefined;
    if (!key) return;
    sankeySelection = sankeySelection.includes(key) ? sankeySelection.filter(selected => selected !== key) : [...sankeySelection, key];
    inspection.sankeySelection = sankeySelection;
  }
  function togglePause() {
    const next = !paused;
    frozen = next && current ? structuredClone($state.snapshot(current)) : undefined;
    paused = next;
    inspection.paused = paused; inspection.frozen = frozen;
  }
  function rememberZoom(event: unknown) {
    const action = event as { batch?: { dataZoomId?: string; start?: number; end?: number }[]; dataZoomId?: string; start?: number; end?: number };
    for (const change of action.batch ?? [action]) {
      if (typeof change.start !== "number" || typeof change.end !== "number") continue;
      const range = { start: change.start, end: change.end };
      if (change.dataZoomId === "y-inside") inspection.y = range; else inspection.x = range;
    }
    updateZoomLevel();
  }
  function updateZoomLevel() {
    zoomLevel = Math.round(10000 / Math.max(1, Math.min(inspection.x.end - inspection.x.start, inspection.y.end - inspection.y.start)));
  }
  function pointerPosition(event: Pick<MouseEvent, "clientX" | "clientY">): ChartPoint {
    const bounds = host!.getBoundingClientRect();
    return [(event.clientX - bounds.left) * chart!.getWidth() / bounds.width, (event.clientY - bounds.top) * chart!.getHeight() / bounds.height];
  }
  function beginSelection(event: PointerEvent) {
    if (!cartesian || !visible || !chart || !host || selection || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const start = pointerPosition(event);
    if (!chart.containPixel({ gridIndex: 0 }, [...start])) return;
    event.preventDefault(); event.stopPropagation();
    host.closest<HTMLElement>(".plot-viewport")?.focus({ preventScroll: true });
    host.setPointerCapture(event.pointerId);
    selection = { pointerId: event.pointerId, start, end: start, axisOnly: event.shiftKey };
    chart.dispatchAction({ type: "hideTip" });
  }
  function moveSelection(event: PointerEvent) {
    if (!selection || selection.pointerId !== event.pointerId || !chart) return;
    event.preventDefault(); event.stopPropagation();
    selection = { ...selection, end: pointerPosition(event), axisOnly: event.shiftKey };
    chart.dispatchAction({ type: "hideTip" });
  }
  function endSelection(event: PointerEvent) {
    if (!selection || selection.pointerId !== event.pointerId || !chart || !host) return;
    event.preventDefault(); event.stopPropagation();
    const box = chartSelection(selection.start, pointerPosition(event), chartPlotBounds(chart.getWidth(), chart.getHeight(), series.length > 1, legendLayout.height), event.shiftKey);
    selection = null;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if (!box) return;
    const first = chart.convertFromPixel({ gridIndex: 0 }, [box.left, box.top]) as number[];
    const last = chart.convertFromPixel({ gridIndex: 0 }, [box.right, box.bottom]) as number[];
    if (!first?.every(Number.isFinite) || !last?.every(Number.isFinite)) return;
    chart.dispatchAction({ type: "dataZoom", batch: [
      ...(box.zoomX ? [{ dataZoomId: "x-slider", startValue: Math.min(first[0]!, last[0]!), endValue: Math.max(first[0]!, last[0]!) }] : []),
      ...(box.zoomY ? [{ dataZoomId: "y-inside", startValue: Math.min(first[1]!, last[1]!), endValue: Math.max(first[1]!, last[1]!) }] : [])
    ] });
    // Value-based selections are normalized to percentages by the chart model.
    const ranges = chart.getOption().dataZoom as { id?: string; start?: number; end?: number }[];
    for (const range of ranges) {
      if (typeof range.start !== "number" || typeof range.end !== "number") continue;
      if (range.id === "x-slider") inspection.x = { start: range.start, end: range.end };
      if (range.id === "y-inside") inspection.y = { start: range.start, end: range.end };
    }
    updateZoomLevel();
  }
  function cancelSelection(event: PointerEvent) {
    if (selection?.pointerId === event.pointerId) selection = null;
  }
  function cancelSelectionKey(event: KeyboardEvent) {
    if (event.key === "Shift" && selection) { selection = { ...selection, axisOnly: event.type === "keydown" }; return; }
    if (event.key !== "Escape" || !selection) return;
    event.preventDefault(); event.stopPropagation();
    const id = selection.pointerId; selection = null;
    if (host?.hasPointerCapture(id)) host.releasePointerCapture(id);
  }
  async function wheelMagnification(event: WheelEvent) {
    if (!visible || !host || !chart) return;
    if (legendLayout.items.length && pointerPosition(event)[1] <= legendLayout.height + 8) {
      if (legendLayout.scroll && !event.ctrlKey && !event.metaKey) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const before = inspection.legendScroll ?? 0;
        const next = Math.max(0, Math.min(legendLayout.items.length - 1, before + Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 40))));
        if (next !== before) {
          event.preventDefault(); event.stopPropagation();
          chart.dispatchAction({ type: "legendScroll", legendId: "view-legend", scrollDataIndex: next });
        }
      }
      return;
    }
    if (cartesian || event.shiftKey || !event.deltaY) return;
    const viewport = host.closest<HTMLElement>(".plot-viewport");
    if (!viewport) return;
    event.preventDefault(); event.stopPropagation();
    const element = host, bounds = viewport.getBoundingClientRect();
    const anchorX = event.clientX - bounds.left, anchorY = event.clientY - bounds.top;
    const left = viewport.scrollLeft, top = viewport.scrollTop, width = element.clientWidth, height = element.clientHeight;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    zoomBy(Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.002));
    await tick();
    if (!element.isConnected) return;
    viewport.scrollLeft = (left + anchorX) * element.clientWidth / width - anchorX;
    viewport.scrollTop = (top + anchorY) * element.clientHeight / height - anchorY;
  }
  function download() {
    const table = data.kind === "table";
    const url = table ? URL.createObjectURL(new Blob([JSON.stringify({ columns: current?.columns, rows }, null, 2)], { type: "application/json" })) : chart?.getDataURL({ type: "svg" });
    if (!url) return;
    const link = document.createElement("a"); link.href = url; link.download = `${data.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100)}.${table ? "json" : "svg"}`;
    document.body.append(link); link.click(); link.remove();
    if (table) setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  onMount(() => {
    const palette = new MutationObserver(() => { paletteRevision += 1; });
    palette.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-palette"] });
    return () => palette.disconnect();
  });
  onMount(() => {
    const element = host;
    if (!element) return;
    let resizeFrame: number | undefined;
    let width = 0, height = 0;
    const resize = () => {
      const nextWidth = element.clientWidth, nextHeight = element.clientHeight;
      if (!nextWidth || !nextHeight || nextWidth === width && nextHeight === height) return;
      width = nextWidth; height = nextHeight;
      chartSize = { width, height };
      if (!chart) {
        chart = init(element, undefined, { renderer: "svg", width, height });
        chart.on("datazoom", rememberZoom);
        chart.on("click", toggleSankeyHighlight);
        chart.on("legendscroll", (event: unknown) => { inspection.legendScroll = (event as { scrollDataIndex: number }).scrollDataIndex; });
        chart.on("legendselectchanged", (event: unknown) => { inspection.selected = { ...(event as { selected: Record<string, boolean> }).selected }; });
      }
      else chart.resize({ width, height });
    };
    resize();
    element.addEventListener("pointerdown", beginSelection, true);
    element.addEventListener("pointermove", moveSelection, true);
    element.addEventListener("pointerup", endSelection, true);
    element.addEventListener("pointercancel", cancelSelection);
    element.addEventListener("lostpointercapture", cancelSelection);
    element.addEventListener("wheel", wheelMagnification, { capture: true, passive: false });
    window.addEventListener("keydown", cancelSelectionKey, true);
    window.addEventListener("keyup", cancelSelectionKey, true);
    // ResizeObserver delivery must not synchronously change the observed layout.
    // Coalesce wheel/scrollbar notifications, then measure once in the next frame.
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => { resizeFrame = undefined; resize(); });
    });
    observer.observe(element);
    return () => {
      element.removeEventListener("pointerdown", beginSelection, true);
      element.removeEventListener("pointermove", moveSelection, true);
      element.removeEventListener("pointerup", endSelection, true);
      element.removeEventListener("pointercancel", cancelSelection);
      element.removeEventListener("lostpointercapture", cancelSelection);
      element.removeEventListener("wheel", wheelMagnification, true);
      window.removeEventListener("keydown", cancelSelectionKey, true);
      window.removeEventListener("keyup", cancelSelectionKey, true);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      observer.disconnect(); chart?.dispose(); chart = undefined;
    };
  });

  $effect(() => {
    paletteRevision;
    if (!chart || !host) return;
    if (!visible) { chart.clear(); return; }
    const style = getComputedStyle(host);
    let palette;
    try { palette = chartPalette(style); themeError = ""; }
    catch (cause) { themeError = (cause as Error).message; chart.clear(); return; }
    const { foreground, muted, surface } = palette;
    const fontSize = 12 * (cartesian ? 1 : scale);
    const pattern = $chartSettingsState.patterns[data.kind === "table" ? "bar" : data.kind];
    const patternStyle = (color: string) => {
      const decal = chartDecal(pattern, color);
      return decal ? { decal } : {};
    };
    const styles = chartNamedStyles(data.kind === "pie" ? (series[0]?.points ?? []).map(point => String(point.x))
      : data.kind === "sankey" ? current!.nodes.map(node => node.name) : series.map(item => chartSeriesName(data, item)), palette);
    const identity = (name: string) => styles.get(name)!;
    const scrollDataIndex = Math.max(0, Math.min(legendLayout.items.length - 1, inspection.legendScroll ?? 0));
    inspection.legendScroll = scrollDataIndex;
    const legend = { id: "view-legend", top: 0, left: "center", width: legendLayout.available, padding: 0,
      type: legendLayout.scroll ? "scroll" as const : "plain" as const, scrollDataIndex,
      itemWidth: legendLayout.itemWidth, itemHeight: 10, itemGap: legendLayout.itemGap,
      data: legendLayout.items.map(item => ({ name: item.name, textStyle: { width: item.width, overflow: "truncate" as const }, tooltip: { show: item.truncated } })),
      selected: inspection.selected, textStyle: { color: foreground, fontSize, lineHeight: legendLayout.lineHeight }, inactiveColor: muted,
      inactiveBorderColor: muted, pageIconColor: foreground, pageIconInactiveColor: muted, pageTextStyle: { color: foreground } };
    const base: EChartsOption = {
      animation: false, color: palette.colors,
      textStyle: { fontFamily: style.fontFamily, color: foreground, fontSize }, aria: { enabled: true },
      tooltip: { trigger: ["pie", "scatter", "sankey"].includes(data.kind) ? "item" : "axis", renderMode: "richText", confine: true,
        backgroundColor: surface, borderColor: muted, shadowBlur: 0, shadowColor: "transparent", shadowOffsetX: 0, shadowOffsetY: 0, textStyle: { color: foreground, fontFamily: style.fontFamily },
        axisPointer: { lineStyle: { color: muted }, shadowStyle: { color: muted, opacity: 0.15 }, crossStyle: { color: muted },
          label: { backgroundColor: surface, color: foreground } } }
    };
    let option: EChartsOption;
    if (data.kind === "sankey") {
      const highlights = sankeyHighlights(current!, sankeySelection);
      option = { ...base,
      series: [{ type: "sankey", nodeWidth: 20 * scale, nodeGap: 8 * scale, label: { color: foreground, fontSize }, emphasis: { disabled: true },
        data: current!.nodes.map(node => {
          const visual = identity(node.name), selected = highlights.selectedNodes.has(node.name);
          const opacity = !highlights.active || highlights.nodes.has(node.name) ? 1 : 0.25;
          return { ...node, label: { opacity, fontWeight: selected ? 700 : 400 },
            itemStyle: { color: visual.color, borderColor: selected ? foreground : surface, borderWidth: selected ? 3 : 1, opacity, ...patternStyle(visual.textColor) } };
        }),
        links: current!.links.map(link => {
          const key = sankeyLinkKey(link.source, link.target);
          return { ...link, lineStyle: { color: identity(link.source).color,
            opacity: !highlights.active ? 0.3 : highlights.selectedLinks.has(key) ? 0.9 : highlights.links.has(key) ? 0.7 : 0.06 } };
        }) }] };
    }
    else if (data.kind === "pie") option = { ...base, legend,
      series: [{ name: data.title, type: "pie", top: legendLayout.height + 12, bottom: 0, radius: "65%", center: ["50%", "55%"], stillShowZeroSum: false,
        percentPrecision: 1, minShowLabelAngle: 12, label: { position: "inside", formatter: "{d}%", fontWeight: 600, fontSize }, labelLayout: { hideOverlap: true },
        data: (series[0]?.points ?? []).filter(point => point.y !== null).map(point => {
          const visual = identity(String(point.x));
          return { name: String(point.x), value: point.y!, label: { color: visual.textColor, textBorderColor: visual.color, textBorderWidth: 3 },
            itemStyle: { color: visual.color, borderColor: surface, borderWidth: 1, ...patternStyle(visual.textColor) },
            emphasis: { itemStyle: { color: visual.color, borderColor: surface } } };
        }) }] };
    else {
      const categories = [...new Set(series.flatMap(item => item.points.map(point => String(point.x))))];
      option = { ...base,
        legend: { ...legend, show: series.length > 1 },
        grid: chartGridLayout(series.length > 1, legendLayout.height),
        dataZoom: [
          { id: "x-inside", type: "inside", xAxisIndex: 0, filterMode: "none", minSpan: 1, ...inspection.x, zoomOnMouseWheel: true, moveOnMouseMove: "alt" },
          { id: "x-slider", type: "slider", xAxisIndex: 0, filterMode: "none", minSpan: 1, ...inspection.x, bottom: 8, height: 22, brushSelect: false,
            borderColor: muted, backgroundColor: surface, fillerColor: palette.emphasis, textStyle: { color: foreground },
            handleStyle: { color: foreground, borderColor: surface, shadowColor: surface }, moveHandleStyle: { color: muted },
            emphasis: { handleStyle: { color: palette.emphasis, borderColor: foreground }, moveHandleStyle: { color: foreground } },
            dataBackground: { lineStyle: { color: muted }, areaStyle: { color: surface } },
            selectedDataBackground: { lineStyle: { color: foreground }, areaStyle: { color: palette.emphasis } }, brushStyle: { color: palette.emphasis } },
          { id: "y-inside", type: "inside", yAxisIndex: 0, filterMode: "none", minSpan: 1, ...inspection.y,
            zoomOnMouseWheel: true, moveOnMouseMove: "alt" }
        ],
        xAxis: { type: data.xAxis, ...(data.xAxis === "category" ? { data: categories } : {}),
          axisLabel: { color: foreground, hideOverlap: true }, axisLine: { lineStyle: { color: muted } },
          axisTick: { lineStyle: { color: muted } }, splitLine: { show: false } },
        yAxis: { type: "value", axisLabel: { color: foreground, width: 44, overflow: "truncate", formatter: (value: number) => axisNumbers.format(value) }, axisLine: { lineStyle: { color: muted } },
          axisTick: { lineStyle: { color: muted } }, splitLine: { lineStyle: { color: muted, opacity: 0.4 } } },
        series: series.map(item => {
          const name = chartSeriesName(data, item);
          const visual = identity(name);
          const values = new Map(item.points.map(point => [String(point.x), point.y]));
          return { id: item.id, name, symbol: visual.symbol,
            itemStyle: { color: visual.color, borderColor: foreground, borderWidth: 1, ...patternStyle(visual.textColor) },
            lineStyle: { color: visual.color, type: (pattern === "dashed" || pattern === "dotted" ? pattern : "solid") as "solid" | "dashed" | "dotted", width: 2 },
            emphasis: { itemStyle: { color: visual.color, borderColor: foreground }, lineStyle: { color: visual.color } }, type: data.kind === "area" ? "line" : data.kind as "line" | "bar" | "scatter",
            data: data.xAxis === "category" && data.kind !== "scatter" ? categories.map(key => values.get(key) ?? null)
              : item.points.map(point => [data.xAxis === "category" ? categories.indexOf(String(point.x)) : point.x, point.y]),
            ...(data.kind === "area" ? { areaStyle: { color: visual.color, opacity: 0.2, ...patternStyle(visual.textColor) } } : {}),
            ...(data.kind === "line" || data.kind === "area" ? { showSymbol: item.points.length < 80, connectNulls: false } : {}) };
        })
      };
    }
    chart.setOption(option, { notMerge: true });
  });
</script>

<div bind:this={viewHost} class="chart-view" data-chart-kind={data.kind} data-point-count={count} data-series-count={series.length} data-zoom-level={zoomLevel} data-paused={paused}
  data-legend-mode={legendLayout.items.length ? legendLayout.scroll ? "scroll" : "wrap" : "none"} data-legend-height={legendLayout.height}>
  <div class="chart-toolbar" role="group" aria-label={`${data.title} view controls`}>
    {#if data.kind !== "table"}
      <Button type="button" size="icon-sm" variant="outline" aria-label="Zoom in" tooltip="Zoom in" onclick={() => zoomBy(1.5)} disabled={!visible || zoomLevel >= (cartesian ? 10000 : 400)}><MaterialIcon name="zoom_in" size={20} /></Button>
      <Button type="button" size="icon-sm" variant="outline" aria-label="Zoom out" tooltip="Zoom out" onclick={() => zoomBy(1 / 1.5)} disabled={!visible || zoomLevel <= 100}><MaterialIcon name="zoom_out" size={20} /></Button>
      <Button type="button" size="icon-sm" variant="outline" aria-label="Reset view" tooltip="Reset view" onclick={resetView} disabled={!visible}><MaterialIcon name="restart_alt" size={20} /></Button>
      <output aria-label="Chart zoom">{zoomLevel}%</output>
    {:else}
      <input type="search" aria-label="Filter rows" placeholder="Filter rows…" value={filter} oninput={event => { filter = event.currentTarget.value; inspection.filter = filter; page = 0; inspection.page = 0; }} />
    {/if}
    <Button type="button" size="icon-sm" variant="outline" aria-label={paused ? "Resume updates" : "Pause updates"} tooltip={paused ? "Resume updates" : "Pause updates"} onclick={togglePause} disabled={!current}><MaterialIcon name={paused ? "play_arrow" : "pause"} size={20} /></Button>
    {#if data.kind === "sankey"}<Button type="button" size="icon-sm" variant="outline" class="highlight-control" aria-label={`Clear highlights${sankeySelection.length ? ` (${sankeySelection.length})` : ""}`} tooltip={`Clear highlights${sankeySelection.length ? ` (${sankeySelection.length})` : ""}`} onclick={clearHighlights} disabled={!sankeySelection.length}>
      <MaterialIcon name="deselect" size={20} />{#if sankeySelection.length}<span class="highlight-count" aria-hidden="true">{sankeySelection.length}</span>{/if}
    </Button>{/if}
    <Button type="button" size="icon-sm" variant="outline" aria-label={data.kind === "table" ? "Save JSON" : "Save SVG"} tooltip={data.kind === "table" ? "Save JSON" : "Save SVG"} onclick={download} disabled={!visible}><MaterialIcon name="download" size={20} /></Button>
  </div>
  {#if data.kind !== "table" && paused}<p class="chart-help">Updates paused.</p>{/if}
  {#if data.kind === "table"}
    {#if visible && current}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard focus.) -->
      <div class="table-scroll" tabindex="0" role="region" aria-label={`${data.title} table`}>
        <table><caption class="sr-only">{data.title}</caption><thead><tr>{#each current.columns as column, index (column.id)}<th scope="col" class:numeric={tableFormats[index]?.kind === "number"} class:boolean={tableFormats[index]?.kind === "boolean"}>{column.label}</th>{/each}</tr></thead>
          <tbody>{#each rows.slice(currentPage * 50, (currentPage + 1) * 50) as row}<tr>{#each row as value, index}
            {@const column = tableFormats[index]!}
            <td class:numeric={column.kind === "number"} class:boolean={column.kind === "boolean"}>
              {#if column.kind === "boolean" && (value === "true" || value === "false")}
                {@const colors = booleanStyles?.[value]}
                <span class="boolean-value" style:color={colors?.color} style:background-color={colors?.background}>{value}</span>
              {:else}{column.format(value)}{/if}
            </td>
          {/each}</tr>{/each}</tbody>
        </table>
      </div>
      <nav class="table-pages" aria-label="Table pages">
        {#if currentPage > 0}<Button type="button" size="icon-sm" variant="ghost" class="page-previous" aria-label="Previous" tooltip="Previous page" onclick={() => { page = currentPage - 1; inspection.page = page; }}><MaterialIcon name="arrow_circle_left" size={24} /></Button>{/if}
        <span class="page-summary" aria-live="polite">Page {currentPage + 1} of {pages} · {rows.length} rows{filter ? ` of ${current.rows.length}` : ""}</span>
        {#if currentPage + 1 < pages}<Button type="button" size="icon-sm" variant="ghost" class="page-next" aria-label="Next" tooltip="Next page" onclick={() => { page = currentPage + 1; inspection.page = page; }}><MaterialIcon name="arrow_circle_right" size={24} /></Button>{/if}
      </nav>
      {#if !rows.length}<p role="status">No matching rows.</p>{/if}
    {/if}
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The zoomed scroll region needs keyboard focus.) -->
    <div class="plot-viewport" tabindex="0" role="region" aria-label={`${data.title} plot viewport`}>
      <div class="plot-stage" style:width={`${scale * 100}%`} style:height={`${scale * 100}%`}>
        <div bind:this={host} class="chart-plot" class:selectable={cartesian} role="img" aria-label={`${data.title}: ${count} data points`} class:empty={!visible || !!themeError}></div>
        {#if selectionBox}<div class="chart-selection" aria-hidden="true" style:left={`${selectionBox.left}px`} style:top={`${selectionBox.top}px`}
          style:width={`${selectionBox.right - selectionBox.left}px`} style:height={`${selectionBox.bottom - selectionBox.top}px`}></div>{/if}
      </div>
    </div>
  {/if}
  {#if !visible || themeError}<p class="chart-message" role={current?.error || themeError ? "alert" : "status"}>{message}</p>{/if}
</div>

<style>
  .chart-view { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; position: relative; gap: 6px; }
  .chart-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12px; }
  .chart-toolbar :global(.highlight-control) { position: relative; }
  .highlight-count { position: absolute; top: -5px; right: -5px; min-width: 14px; padding: 0 3px; border-radius: 8px; background: var(--color-foreground); color: var(--color-background); font-size: 9px; line-height: 14px; font-variant-numeric: tabular-nums; }
  .chart-toolbar input { padding: 7px 10px; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-foreground); background: var(--color-background); min-width: 0; flex: 1; }
  .chart-help { margin: 0; font-size: 11px; opacity: 0.8; flex-shrink: 0; }
  .plot-viewport { flex: 1; min-height: 100px; min-width: 0; overflow: auto; }
  .plot-stage, .chart-plot { width: 100%; height: 100%; }
  .plot-stage { position: relative; }
  .chart-plot.selectable { touch-action: none; user-select: none; }
  .chart-selection { position: absolute; pointer-events: none; border: 1px solid var(--color-emphasis); background: color-mix(in srgb, var(--color-emphasis) 18%, transparent); }
  .chart-plot.empty { visibility: hidden; }
  .chart-message { display: grid; place-content: center; margin: 0; padding: 24px; font-size: 12px; line-height: 1.5; text-align: center; opacity: 0.8; }
  .chart-message[role="alert"] { color: var(--color-error-foreground); background: var(--color-error-background); opacity: 1; }
  .table-scroll { overflow: auto; flex: 1; min-height: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; background: var(--color-background); }
  caption { text-align: left; padding: 8px; }
  th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--color-border); overflow-wrap: anywhere; }
  th { position: sticky; top: 0; z-index: 1; background: var(--color-surface); }
  tbody tr:nth-child(even) { background: color-mix(in srgb, var(--color-foreground) 4%, var(--color-background)); }
  .numeric { text-align: right; }
  .boolean { text-align: center; }
  .boolean-value { display: inline-block; min-width: 5ch; padding: 2px 6px; border-radius: 3px; font-weight: 600; }
  .table-pages { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; gap: 10px; margin-top: 10px; font-size: 11px; }
  .table-pages :global(.page-previous) { grid-column: 1; }
  .page-summary { grid-column: 2; text-align: center; }
  .table-pages :global(.page-next) { grid-column: 3; }
</style>
