<!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { getContext, untrack } from "svelte";
  import { Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import { chartKinds, chartInputs, coordinateChart, validateChartData, type ChartData } from "$lib/workflow-chart.ts";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Handle from "./WorkflowHandle.svelte";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import "./workflow-utility-nodes.css";

  let { id, data, selected }: NodeProps<Node<ChartData, "chart">> = $props();
  const edit = getContext<(id: string, data: ChartData) => void>("workflow-chart");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const inputConnected = getContext<(id: string, handle?: string) => boolean>("workflow-input-connected");
  const active = $derived(editorActive?.() ?? true);
  const updateNodeInternals = useUpdateNodeInternals();
  let error = $state("");
  const choices = chartKinds.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
  const axes = [{ value: "category", label: "Labels" }, { value: "value", label: "Numbers" }, { value: "time", label: "Time" }];
  const inputs = $derived(chartInputs(data));
  const layout = $derived(JSON.stringify([data.kind, inputs, data.columns]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function update(patch: Partial<ChartData>) {
    try { edit(id, validateChartData({ ...data, ...patch })); error = ""; }
    catch (cause) { error = cause instanceof Error ? cause.message : "Check the chart configuration."; }
  }
  function seriesField(seriesId: string, field: "name" | "xPath" | "yPath", value: string) {
    update({ series: data.series.map(series => series.id === seriesId ? { ...series, [field]: value } : series) });
  }
</script>

<div class="workflow-utility-node workflow-chart-node" class:selected>
  <div class="utility-title"><MaterialIcon name="monitoring" size={20} /><strong>{data.title}</strong><span class="utility-type">View</span></div>
  <div class="chart-controls nodrag nopan nokey nowheel">
    <label>Title<input class="utility-value" aria-label="Chart title" value={data.title} maxlength={120} disabled={!active}
      onchange={event => update({ title: event.currentTarget.value.trim() || "Chart" })} /></label>
    <label>View<WorkflowNodeSelect label="Chart view" value={data.kind} {choices} {active}
      onchange={kind => update({ kind: kind as ChartData["kind"], ...(kind === "scatter" && data.xAxis === "category" ? { xAxis: "value" } : {}) })} /></label>
    {#if coordinateChart(data.kind)}
      <label>X axis<WorkflowNodeSelect label="Chart X axis" value={data.xAxis} choices={axes} {active} onchange={xAxis => update({ xAxis: xAxis as ChartData["xAxis"] })} /></label>
    {/if}
  </div>
  {#each inputs as input (input.id)}
    <div class="chart-input nodrag nopan nokey">
      <Handle id={input.id} type="target" position={Position.Left} isConnectableStart={false}
        isConnectableEnd={!inputConnected(id, input.id)} aria-disabled={inputConnected(id, input.id)} aria-label={`${input.name} data input`} />
      {#if coordinateChart(data.kind)}
        {@const series = data.series.find(item => item.id === input.id)!}
        <div class="series-name"><input class="utility-value" aria-label={`Series name ${input.name}`} value={series.name} disabled={!active} maxlength={120}
          onchange={event => seriesField(series.id, "name", event.currentTarget.value)} />
          <Button type="button" size="sm" variant="outline" aria-label={`Remove series ${series.name}`} disabled={!active || data.series.length === 1}
            onclick={() => update({ series: data.series.filter(item => item.id !== series.id) })}><MaterialIcon name="close" size={14} /></Button></div>
        <details ontoggle={() => updateNodeInternals(id)}>
          <summary>Fields <span class="field-hint">(optional)</span></summary>
          <label>X field<input class="utility-value" aria-label={`${series.name} X field`} value={series.xPath} placeholder="/time or row number" disabled={!active}
            onchange={event => seriesField(series.id, "xPath", event.currentTarget.value)} /></label>
          <label>Value field<input class="utility-value" aria-label={`${series.name} value field`} value={series.yPath} placeholder="/cpu or numeric rows" disabled={!active}
            onchange={event => seriesField(series.id, "yPath", event.currentTarget.value)} /></label>
        </details>
      {:else}<strong>{input.name}</strong><span class="utility-type">{data.kind === "sankey" ? "Array" : "JSON"}</span>{/if}
    </div>
  {/each}
  <div class="chart-controls chart-details nodrag nopan nokey nowheel">
    {#if coordinateChart(data.kind)}
      <Button type="button" size="sm" variant="outline" class="add-series" disabled={!active || data.series.length >= 16}
        onclick={() => update({ series: [...data.series, { id: crypto.randomUUID(), name: `Series ${data.series.length + 1}`, xPath: "", yPath: "" }] })}>Add series</Button>
    {:else if data.kind === "pie"}
      <label>Label field<input class="utility-value" aria-label="Pie label field" value={data.xPath} placeholder="/name" disabled={!active} onchange={event => update({ xPath: event.currentTarget.value })} /></label>
      <label>Value field<input class="utility-value" aria-label="Pie value field" value={data.yPath} placeholder="/value" disabled={!active} onchange={event => update({ yPath: event.currentTarget.value })} /></label>
    {:else if data.kind === "sankey"}
      {#each [{ key: "nodePath", label: "Node name field" }, { key: "sourcePath", label: "Link source field" }, { key: "targetPath", label: "Link target field" }, { key: "weightPath", label: "Link value field" }] as const as field}
        <label>{field.label}<input class="utility-value" aria-label={field.label} value={data[field.key]} disabled={!active} onchange={event => update({ [field.key]: event.currentTarget.value })} /></label>
      {/each}
    {:else if data.kind === "table"}
      <p class="field-hint">Columns are detected from rows unless specified.</p>
      {#each data.columns as column (column.id)}
        <div class="table-column">
          <label>Heading<input class="utility-value" aria-label={`Column ${column.label} heading`} value={column.label} disabled={!active} maxlength={120}
            onchange={event => update({ columns: data.columns.map(item => item.id === column.id ? { ...item, label: event.currentTarget.value } : item) })} /></label>
          <label>Field<input class="utility-value" aria-label={`Column ${column.label} field`} value={column.path} disabled={!active} placeholder="/value"
            onchange={event => update({ columns: data.columns.map(item => item.id === column.id ? { ...item, path: event.currentTarget.value } : item) })} /></label>
          <Button type="button" size="sm" variant="outline" aria-label={`Remove column ${column.label}`} disabled={!active} onclick={() => update({ columns: data.columns.filter(item => item.id !== column.id) })}>Remove</Button>
        </div>
      {/each}
      <Button type="button" size="sm" variant="outline" disabled={!active || data.columns.length >= 32} onclick={() => update({ columns: [...data.columns, { id: crypto.randomUUID(), label: `Column ${data.columns.length + 1}`, path: "" }] })}>Add column</Button>
    {/if}
    <label>Point / row limit<input class="utility-value" aria-label="Chart point limit" type="number" min="1" max="2000" value={data.maxPoints} disabled={!active}
      onchange={event => update({ maxPoints: Number(event.currentTarget.value) })} /></label>
  </div>
  {#if error}<p class="chart-config-error" role="alert">{error}</p>{/if}
  <p class="run-hint">View results in Run workflow.</p>
</div>

<style>
  .workflow-chart-node { display: flex; flex-direction: column; width: 360px; min-width: 360px; }
  .chart-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px 10px; padding: 8px 12px; }
  label { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 10px; }
  .chart-input { position: relative; padding: 8px 12px; border-top: 1px solid var(--color-border); }
  .series-name { display: flex; gap: 6px; }
  .series-name input { flex: 1; min-width: 0; }
  details { margin-top: 4px; }
  details label { margin-top: 4px; }
  summary { cursor: pointer; font-size: 11px; }
  .field-hint, .run-hint { font-size: 10px; opacity: 0.7; }
  .chart-details > p, .table-column { grid-column: 1 / -1; }
  .table-column { display: grid; gap: 5px; }
  .chart-config-error { margin: 4px 12px; padding: 8px; font-size: 11px; color: var(--color-error-foreground); background: var(--color-error-background); }
  .run-hint { margin: 4px 12px 10px; }
</style>
