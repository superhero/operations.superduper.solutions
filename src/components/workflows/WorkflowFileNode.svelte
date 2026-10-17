<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext, onDestroy } from "svelte";
  import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import JsonSchemaView from "$lib/components/JsonSchemaView.svelte";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import { defaultCsvOptions, fileValueType, type CsvOptions, type WorkflowFileData, type UploadedWorkflowFile } from "$lib/workflow-file.ts";
  import { parseWorkflowFileAsync } from "$lib/workflow-file-client.ts";
  import "./workflow-utility-nodes.css";
  let { id, data, selected }: NodeProps<Node<WorkflowFileData, "file">> = $props();
  const update = getContext<(id: string, data: WorkflowFileData) => void>("workflow-file");
  const editorActive = getContext<() => boolean>("workflow-editor-active");
  let input: HTMLInputElement;
  let pending = $state.raw<File>();
  let draftOptions = $state<CsvOptions>({ ...defaultCsvOptions });
  let busy = $state(false);
  let error = $state("");
  let controller: AbortController | undefined;
  const type = $derived(fileValueType(data.file));
  const options = $derived(pending ? draftOptions : data.file?.options ?? defaultCsvOptions);
  onDestroy(() => controller?.abort());
  $effect(() => { if (!editorActive()) controller?.abort(); });
  async function parse(file: File | UploadedWorkflowFile, next = options) {
    controller?.abort();
    const request = new AbortController(); controller = request;
    busy = true; error = "";
    try {
      const result = await parseWorkflowFileAsync(file, next, request.signal);
      if (!request.signal.aborted && editorActive()) update(id, { file: result });
    } catch (cause) {
      if (!request.signal.aborted) error = cause instanceof Error ? cause.message : "The file could not be read.";
    } finally { if (controller === request) busy = false; }
  }
  function configure(patch: Partial<CsvOptions>) {
    const file = pending ?? data.file;
    draftOptions = { ...options, ...patch };
    if (file) void parse(file, draftOptions);
  }
</script>
<div class="workflow-utility-node workflow-file-node" class:selected aria-busy={busy}>
  <div class="utility-title"><MaterialIcon name="upload_file" size={20} /><strong>File upload</strong></div>
  <div class="utility-row nodrag nopan nokey">
    <HintButton label="Upload JSON or CSV" labelAsName={false} tooltipSide="bottom" class="file-upload" onclick={() => input.click()}>
      <span>Upload file</span>
    </HintButton>
    <span class="utility-type">{type}</span>
    <Handle id="value" type="source" position={Position.Right} isConnectable={!!data.file}
      isConnectableEnd={false} aria-label={`File output (${type})`} />
    <input class="file-picker" bind:this={input} type="file" accept=".json,.csv,application/json,text/csv" aria-label="Upload workflow data file"
      onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { pending = file; draftOptions = { ...defaultCsvOptions }; void parse(file, draftOptions); } }} />
  </div>
  {#if pending ? /\.csv$/i.test(pending.name) : data.file?.format === "csv"}
    <div class="csv-options nodrag nopan nokey nowheel">
      <label>Delimiter
        <WorkflowNodeSelect label="CSV delimiter" value={options.delimiter} active={editorActive()}
          choices={[{ value: "auto", label: "Auto" }, { value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }, { value: "\t", label: "Tab" }, { value: "|", label: "Pipe" }]}
          onchange={delimiter => configure({ delimiter: delimiter as CsvOptions["delimiter"] })} />
      </label>
      <label>Header
        <WorkflowNodeSelect label="CSV header" value={options.header} active={editorActive()}
          choices={[{ value: "auto", label: "Auto" }, { value: "present", label: "First row" }, { value: "absent", label: "No header" }]}
          onchange={header => configure({ header: header as CsvOptions["header"] })} />
      </label>
      <label>Quotes
        <WorkflowNodeSelect label="CSV quotes" value={options.quote} active={editorActive()}
          choices={[{ value: "auto", label: "Auto" }, { value: "none", label: "None" }, { value: '"', label: "Double" }, { value: "'", label: "Single" }]}
          onchange={quote => configure({ quote: quote as CsvOptions["quote"] })} />
      </label>
      <p>{data.file?.header ? "Header row" : "No header"} · {Array.isArray(data.file?.value) ? data.file.value.length : 0} rows</p>
    </div>
  {/if}
  {#if data.file}<div class="file-preview nodrag nopan nokey nowheel"><JsonSchemaView value={data.file.value} label="File data" title="Schema" copyable={false} /></div>{/if}
  {#if error}<p class="file-error nodrag nopan nokey" role="alert">{error}</p>{/if}
</div>
<style>
  .workflow-file-node { width: 360px; }
  :global(.file-upload) { display: flex; align-items: center; justify-content: center; flex: 1; min-width: 0; padding: 6px 8px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 11px; font-weight: 700; text-align: center; }
  :global(.file-upload > span:last-child) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-picker { display: none; }
  .csv-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 8px 12px; border-top: 1px solid var(--color-border); }
  .csv-options label { display: grid; gap: 4px; min-width: 0; font-size: 11px; }
  .csv-options p { grid-column: 1 / -1; margin: 0; font-size: 10px; }
  .file-preview { padding: 0 12px 8px; }
  .file-preview :global(.schema-disclosure) { margin-top: 8px; }
  .file-preview :global(.schema-disclosure > summary) { position: relative; top: auto; min-height: 30px; padding: 2px 6px; gap: 6px; font-size: 11px; }
  .file-preview :global(.schema-disclosure .schema-action) { flex-basis: 24px; width: 24px; height: 24px; }
  .file-preview :global(.schema-wrap-control) { flex-basis: 24px; }
  .file-error { padding: 8px 12px; margin: 0; font-size: 11px; color: var(--color-error-foreground); overflow-wrap: anywhere; }
</style>
