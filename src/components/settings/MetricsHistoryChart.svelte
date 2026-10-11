<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import type { MetricsBar } from "$lib/metrics-history.ts";
  import type { MetricSeries } from "$lib/metrics-series.ts";
  import { formatLocalDateTime } from "$lib/datetime.ts";
  import HintButton from "$lib/components/HintButton.svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import FieldTreeSelect from "$lib/components/FieldTreeSelect.svelte";

  let { bars = [], activeBar = null, series = [] }:
    { bars?: MetricsBar[]; activeBar?: MetricsBar | null; series?: MetricSeries[] } = $props();
  const id = $props.id();
  let chosenKey = $state("");
  let range = $state("day");
  let selectedStart = $state<number | null>(null);
  const metric = $derived(series.find(entry => entry.key === chosenKey) ?? series[0]);
  const intervals = $derived([...bars.filter(bar => bar.start !== activeBar?.start), ...(activeBar ? [activeBar] : [])]
    .sort((left, right) => left.start - right.start));
  const end = $derived(intervals.at(-1)?.end ?? 0);
  const start = $derived(Math.max(intervals[0]?.start ?? 0, range === "all" ? 0 : end - (range === "week" ? 7 : 1) * 86_400_000));
  const candles = $derived(intervals.filter(bar => bar.start >= start).flatMap(bar => {
    const values = metric && bar.metrics[metric.key];
    return values && values.count > 0 && [values.open, values.high, values.low, values.close].every(Number.isFinite)
      ? [{ ...bar, values, live: bar.start === activeBar?.start }] : [];
  }));
  const selected = $derived(candles.find(bar => bar.start === selectedStart) ?? candles.at(-1));
  const extent = $derived.by(() => {
    let low = Infinity, high = -Infinity;
    for (const bar of candles) { low = Math.min(low, bar.values.low); high = Math.max(high, bar.values.high); }
    if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1 };
    const padding = (high - low || Math.abs(high) || 1) * 0.12;
    return { low: Math.max(0, low - padding), high: high + padding };
  });
  const left = 16, right = 784, top = 16, bottom = 176;
  const x = (timestamp: number) => left + (timestamp - start) / Math.max(1, end - start) * (right - left);
  const y = (value: number) => bottom - (value - extent.low) / (extent.high - extent.low) * (bottom - top);
  const ticks = $derived([extent.high, (extent.high + extent.low) / 2, extent.low]);

  function format(value: number): string {
    if (metric?.unit === "ratio") return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    if (metric?.unit === "ms") return value.toLocaleString(undefined, { style: "unit", unit: "millisecond", unitDisplay: "short", maximumFractionDigits: 2 });
    if (metric?.unit !== "bytes") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const unit = value > 0 ? Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
  }

  function description(bar: typeof candles[number]): string {
    const { open, high, low, close, count } = bar.values;
    return `${formatLocalDateTime(bar.start)} – ${formatLocalDateTime(bar.end)}${bar.live ? ", live interval" : ""}. Open ${format(open)}, high ${format(high)}, low ${format(low)}, close ${format(close)}. ${count} samples.`;
  }

  function valuesLabel(bar: typeof candles[number]): string {
    const { open, close, high, low } = bar.values;
    const values = [`Open ${format(open)}`, `Close ${format(close)}`];
    if (high !== open && high !== close) values.push(`High ${format(high)}`);
    if (low !== open && low !== close) values.push(`Low ${format(low)}`);
    return values.join(" · ");
  }

  function navigate(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowLeft") next--;
    else if (event.key === "ArrowRight") next++;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = candles.length - 1;
    else if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    next = Math.max(0, Math.min(candles.length - 1, next));
    selectedStart = candles[next]!.start;
    (event.currentTarget as SVGGElement).ownerSVGElement?.querySelectorAll<SVGGElement>("[data-candle]")[next]?.focus();
  }
</script>

<section class="metrics-history" aria-label="Histogram">
  <div class="history-heading">
    <h3>Histogram</h3>
    <div class="history-controls">
      <div class="history-control">
        <FieldTreeSelect id={`${id}-metric`} label="Metric" value={metric?.key ?? ""} disabled={!series.length}
          options={series.map(entry => ({ value: entry.key, label: entry.label, path: entry.path ?? entry.label.split(" · ") }))}
          onValueChange={value => { chosenKey = value; selectedStart = null; }} />
      </div>
      <div class="history-control">
        <FieldSelect id={`${id}-range`} label="Range" value={range} includePlaceholder={false}
          options={[{ value: "day", label: "Latest 24 hours" }, { value: "week", label: "Latest 7 days" }, { value: "all", label: "All history" }]}
          onValueChange={value => { range = value; }} />
      </div>
    </div>
  </div>

  {#if candles.length}
    <div class="chart-surface">
      <svg viewBox="0 0 800 192" role="group" aria-label={`${metric?.label ?? "Metric"} history candlesticks`}>
        {#each ticks as tick}
          <line class="grid-line" x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
        {/each}
        {#each candles as bar, index (bar.start)}
          {@const center = x((bar.start + bar.end) / 2)}
          {@const width = Math.max(1, Math.min(20, (x(bar.end) - x(bar.start)) * 0.65))}
          <HintButton label={valuesLabel(bar)} bottomLabel={`${formatLocalDateTime(bar.start)} · 15min`}
            aria-label={description(bar)} tabindex={selected?.start === bar.start ? 0 : -1}>
            {#snippet child({ props })}
              {@const { type: _type, ...hintProps } = props}
              <g {...hintProps} data-candle={bar.start} class="candle" class:live={bar.live} class:rising={bar.values.close > bar.values.open} class:falling={bar.values.close < bar.values.open}
                class:selected={selected?.start === bar.start} role="button" aria-pressed={selected?.start === bar.start}
                onpointerenter={event => { if (typeof props.onpointerenter === "function") props.onpointerenter(event); selectedStart = bar.start; }}
                onfocus={event => { if (typeof props.onfocus === "function") props.onfocus(event); selectedStart = bar.start; }}
                onclick={event => { if (typeof props.onclick === "function") props.onclick(event); event.currentTarget.focus(); }}
                onkeydown={event => { if (typeof props.onkeydown === "function") props.onkeydown(event); navigate(event, index); }}>
                <rect class="hit-area" x={center - Math.max(5, width / 2)} y={top} width={Math.max(10, width)} height={bottom - top} />
                <line class="wick" x1={center} x2={center} y1={y(bar.values.high)} y2={y(bar.values.low)} />
                <rect class="body" x={center - width / 2} y={Math.min(y(bar.values.open), y(bar.values.close))}
                  width={width} height={Math.max(1.5, Math.abs(y(bar.values.open) - y(bar.values.close)))} />
              </g>
            {/snippet}
          </HintButton>
        {/each}
      </svg>
    </div>
  {:else}
    <p class="empty-state">No samples recorded for {metric?.label ?? "this metric"} in this range yet.</p>
  {/if}
</section>

<style>
  .metrics-history { min-width: 0; color: var(--color-foreground); }
  .history-heading { display: grid; gap: 12px; margin-bottom: 12px; }
  .history-controls { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: end; gap: 12px; }
  h3 { margin: 0; font-size: 16px; font-weight: 700; }
  .history-control { display: grid; gap: 4px; min-width: 0; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .history-control:first-child { grid-column: span 3; }
  .history-control :global(.field-select-trigger) { max-width: 100%; min-height: 34px; padding: 6px 10px; border-radius: 4px; }
  .history-control :global(.field-select-value) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-state { margin: 0; font-size: 11px; line-height: 1.6; color: var(--color-muted-foreground); }
  .chart-surface { margin-top: 14px; overflow-x: auto; border-radius: 4px; background: var(--color-background); }
  svg { display: block; width: 100%; min-width: 600px; }
  .grid-line { stroke: var(--color-surface); stroke-width: 1; }
  .candle { color: var(--color-foreground); cursor: pointer; outline: none; }
  .candle.rising { color: var(--color-muted-foreground); }
  .candle.falling { color: var(--color-foreground); }
  .wick, .body { stroke: currentColor; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .body { fill: currentColor; }
  .falling .body { fill: var(--color-background); }
  .live .wick, .live .body { stroke-dasharray: 3 2; }
  .hit-area { fill: transparent; }
  .candle:focus-visible .hit-area { stroke: var(--color-foreground); stroke-width: 1; }
  .empty-state { padding: 22px 0 8px; }
</style>
