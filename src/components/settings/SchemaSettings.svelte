<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import JsonSchemaView from "$lib/components/JsonSchemaView.svelte";
  import type { SchemaLibraryRecord } from "$lib/schema-library-types.ts";

  let { records, busy = false, ready = true, error = "", onUpload, onReplace, onRename, onMove, onEnabledChange, onDelete, onDownload, onRetry }: {
    records: SchemaLibraryRecord[];
    busy?: boolean;
    ready?: boolean;
    error?: string;
    onUpload: (file: File) => Promise<void>;
    onReplace: (id: string, file: File) => Promise<void>;
    onRename: (id: string, name: string) => Promise<void>;
    onMove: (id: string, targetId: string, placement: "before" | "after") => Promise<void>;
    onEnabledChange: (id: string, enabled: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onDownload: (record: SchemaLibraryRecord) => void;
    onRetry: () => Promise<void>;
  } = $props();

  let uploadInput: HTMLInputElement;
  let replaceInput: HTMLInputElement;
  let replacingId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let nameDrafts = $state<Record<string, string | undefined>>({});
  const queuedNames = new Map<string, { name: string }>();
  let renaming = $state(0);
  let draggingId = $state<string | null>(null);
  let dragSurfaceActive = $state(false);
  let dragSurfaceFrame = 0;
  let dropTarget = $state<{ id: string; placement: "before" | "after" } | null>(null);
  let previewOrder = $state<string[] | null>(null);
  let schemaList = $state<HTMLUListElement>();
  let previewGeneration = 0;
  let committingDrop = false;
  let pending = $state<string | null>(null);
  let actionError = $state("");
  const working = $derived((busy && renaming === 0) || pending !== null);
  const mutationsDisabled = $derived(working || !ready);
  const displayedError = $derived(actionError || error);
  const acceptedFiles = ".json,.yaml,.yml,application/json,application/yaml,text/yaml";
  const displayedRecords = $derived.by(() => {
    if (!previewOrder) return records;
    const remaining = new Map(records.map(record => [record.id, record]));
    const ordered: SchemaLibraryRecord[] = [];
    for (const id of previewOrder) {
      const record = remaining.get(id);
      if (record) { ordered.push(record); remaining.delete(id); }
    }
    return [...ordered, ...remaining.values()];
  });

  function slideDuration() { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180; }

  async function setPreviewOrder(order: string[] | null) {
    const generation = ++previewGeneration;
    const cards = Array.from(schemaList?.children ?? []).filter((card): card is HTMLElement => card instanceof HTMLElement);
    const positions = new Map(cards.map(card => [card, card.getBoundingClientRect().top]));
    for (const card of cards) card.getAnimations().forEach(animation => animation.cancel());
    previewOrder = order;
    await tick();
    if (generation !== previewGeneration) return;
    const duration = slideDuration();
    if (!duration) return;
    for (const card of cards) {
      const distance = positions.get(card)! - card.getBoundingClientRect().top;
      if (Math.abs(distance) > 0.5) card.animate([{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }], { duration, easing: "ease" });
    }
  }

  function details(record: SchemaLibraryRecord) {
    return {
      title: record.summary.name,
      server: record.summary.serverUrl,
      operations: record.summary.operationCount
    };
  }

  async function run(message: string, action: () => Promise<void>) {
    if (working) return;
    pending = message;
    actionError = "";
    try { await action(); }
    catch (failure) { actionError = failure instanceof Error ? failure.message : "Could not update this OpenAPI document. Please try again."; }
    finally { pending = null; }
  }

  function selectFile(event: Event, replacing = false) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const id = replacingId;
    input.value = "";
    if (replacing) replacingId = null;
    if (!file) return;
    if (mutationsDisabled) return;
    if (replacing && id !== null) void run(`Replacing ${file.name}…`, () => onReplace(id, file));
    else if (!replacing) void run(`Uploading ${file.name}…`, () => onUpload(file));
  }

  function chooseReplacement(id: string) {
    replacingId = id;
    replaceInput.click();
  }

  async function saveName(id: string, currentName: string) {
    const draft = nameDrafts[id];
    if (!ready || draft === undefined) return;
    const name = draft.trim();
    if (!name) { actionError = "Enter a schema name."; return; }
    const queued = queuedNames.get(id);
    if (name === (queued?.name ?? currentName)) {
      if (!queued) delete nameDrafts[id];
      actionError = "";
      return;
    }
    const request = { name };
    queuedNames.set(id, request);
    // The library queues saves. Keep adjacent fields/actions usable when blur starts a save.
    renaming += 1;
    actionError = "";
    try {
      await onRename(id, name);
      if (queuedNames.get(id) === request && nameDrafts[id] === draft) delete nameDrafts[id];
    }
    catch (failure) { actionError = failure instanceof Error ? failure.message : "Could not save the schema name. Please try again."; }
    finally {
      if (queuedNames.get(id) === request) queuedNames.delete(id);
      renaming -= 1;
    }
  }

  function cancelDrag() {
    cancelAnimationFrame(dragSurfaceFrame);
    dragSurfaceActive = false;
    draggingId = null;
    dropTarget = null;
    if (!committingDrop) void setPreviewOrder(null);
  }

  function startDrag(event: DragEvent, id: string) {
    if (mutationsDisabled || !event.dataTransfer) { event.preventDefault(); return; }
    const handle = event.currentTarget as HTMLElement;
    const card = handle.closest<HTMLElement>(".schema-card");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    if (card) {
      const bounds = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, event.clientX - bounds.left, event.clientY - bounds.top);
    }
    previewOrder = records.map(record => record.id);
    draggingId = id;
    // Let native dragging initialize before replacing its pointer target.
    dragSurfaceFrame = requestAnimationFrame(() => { dragSurfaceActive = draggingId === id; });
  }

  function dragOver(event: DragEvent) {
    if (!draggingId || mutationsDisabled) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const list = schemaList;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    const cards = Array.from(list.children)
      .filter((card): card is HTMLElement => card instanceof HTMLElement && card.dataset.schemaId !== draggingId);
    // Use layout positions, independent of the visible slide animation.
    const before = cards.find(card => event.clientY < listTop + card.offsetTop + card.offsetHeight / 2);
    const target = before ?? cards.at(-1);
    dropTarget = target?.dataset.schemaId ? { id: target.dataset.schemaId, placement: before ? "before" : "after" } : null;
    if (!dropTarget) return;
    const order = displayedRecords.filter(record => record.id !== draggingId).map(record => record.id);
    const index = before ? order.indexOf(dropTarget.id) : order.length;
    order.splice(index, 0, draggingId);
    if (order.some((id, index) => previewOrder?.[index] !== id)) void setPreviewOrder(order);
  }

  function dropSchema(event: DragEvent) {
    if (!draggingId) return;
    event.preventDefault();
    const id = draggingId;
    const target = dropTarget;
    const changed = previewOrder?.some((id, index) => records[index]?.id !== id);
    committingDrop = Boolean(target && changed && !mutationsDisabled);
    cancelDrag();
    if (target && committingDrop) {
      void run("", () => onMove(id, target.id, target.placement)).finally(() => {
        committingDrop = false;
        void setPreviewOrder(null);
      });
    }
  }

  function moveWithKeyboard(event: KeyboardEvent, id: string) {
    if (event.key === "Escape") { cancelDrag(); return; }
    if (mutationsDisabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const index = records.findIndex(record => record.id === id);
    const target = records[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (target) void run("", () => onMove(id, target.id, event.key === "ArrowUp" ? "before" : "after"));
  }
</script>

<section class="schema-settings" aria-label="OpenAPI documents" aria-busy={working || renaming > 0}>
  <input bind:this={uploadInput} type="file" accept={acceptedFiles} aria-label="Upload OpenAPI document" hidden disabled={mutationsDisabled} onchange={event => selectFile(event)} />
  <input bind:this={replaceInput} type="file" accept={acceptedFiles} aria-label="Replace OpenAPI document" hidden disabled={mutationsDisabled} onchange={event => selectFile(event, true)} />

  <div class="schema-toolbar">
    <Button class="upload-action" size="sm" variant="secondary" aria-label="Upload OpenAPI document" disabled={mutationsDisabled} onclick={() => uploadInput.click()}>
      <MaterialIcon name="upload_file" size={20} />
      <span>Upload</span>
    </Button>
    <p class="schema-upload-guidance">an OpenAPI 3.0 or 3.1 document in JSON or YAML format.</p>
  </div>

  {#if working && pending !== ""}<p class="schema-status" role="status">{pending ?? "Loading OpenAPI documents…"}</p>{/if}
  {#if displayedError}
    <div class="schema-error">
      <p role="alert">{displayedError}</p>
      <Button size="sm" disabled={working} onclick={() => run("Reloading OpenAPI documents…", onRetry)}>Reload documents</Button>
    </div>
  {/if}

  {#if records.length}
    <div class="schema-drag-area" role="group" aria-label="Reorder schemas" ondragenter={dragOver} ondragover={dragOver} ondrop={dropSchema}>
    <ul class="schema-list" bind:this={schemaList}>
      {#each records as record (record.id)}
        {@const metadata = details(record)}
        <li class="schema-card" class:dragging={draggingId === record.id} data-schema-id={record.id}
          style:order={previewOrder?.indexOf(record.id)}>
          <div class="schema-heading">
            <div class="schema-name">
              <label class="schema-name-icon" for={`schema-name-${record.id}`}><MaterialIcon name="edit_line" size={20} /><span class="sr-only">Schema name</span></label>
              <input id={`schema-name-${record.id}`} class="schema-name-input" value={nameDrafts[record.id] ?? metadata.title} aria-label="Schema name" required disabled={mutationsDisabled}
                aria-invalid={nameDrafts[record.id] !== undefined && !nameDrafts[record.id]?.trim()}
                oninput={event => nameDrafts[record.id] = event.currentTarget.value}
                onblur={() => saveName(record.id, metadata.title)}
                onkeydown={event => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    delete nameDrafts[record.id];
                    event.currentTarget.value = metadata.title;
                    actionError = "";
                    event.currentTarget.blur();
                  } else if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                }} />
            </div>
            <div class="schema-actions" role="group" aria-label={`Actions for ${metadata.title}`}>
              <Button size="icon-sm" variant="secondary" tooltip={`Replace ${metadata.title}`} aria-label={`Replace ${metadata.title}`} disabled={mutationsDisabled} onclick={() => chooseReplacement(record.id)}>
                <MaterialIcon name="upload_file" size={20} />
              </Button>
              <Button size="icon-sm" variant="secondary" tooltip="Download schema" aria-label={`Download ${metadata.title}`} disabled={working} onclick={() => onDownload(record)}>
                <MaterialIcon name="download" size={20} />
              </Button>
              <button class="schema-enabled" type="button" role="switch" aria-label={`Enable ${metadata.title}`} aria-checked={record.enabled} disabled={mutationsDisabled}
                onclick={() => run("", () => onEnabledChange(record.id, !record.enabled))}>
                <span>{record.enabled ? "Enabled" : "Disabled"}</span><span class="default-switch" aria-hidden="true"><span></span></span>
              </button>
              <Button size="icon-sm" variant="secondary" tooltip={`Delete ${metadata.title}`} aria-label={`Delete ${metadata.title}`} disabled={mutationsDisabled || deletingId === record.id} onclick={() => deletingId = record.id}>
                <MaterialIcon name="delete" size={20} />
              </Button>
              <Button class="schema-drag-handle" size="icon-sm" variant="secondary" tooltip="Drag to reorder" aria-label={`Move ${metadata.title}`}
                disabled={mutationsDisabled || records.length < 2} draggable={!mutationsDisabled && records.length > 1}
                ondragstart={event => startDrag(event, record.id)} ondragend={cancelDrag}
                onkeydown={event => moveWithKeyboard(event, record.id)}>
                <MaterialIcon name="swap_vert" size={20} />
              </Button>
            </div>
          </div>

          <dl class="schema-metadata">
            <div><dt>Server URL</dt><dd>{metadata.server}</dd></div>
            <div><dt>Operations</dt><dd>{metadata.operations.toLocaleString()}</dd></div>
          </dl>

          {#if !record.enabled}<p class="schema-note">Operations from this document are unavailable until it is enabled.</p>{/if}

          <JsonSchemaView value={record.document} label={`Full OpenAPI JSON: ${metadata.title}`} operationsOnly />

          {#if deletingId === record.id}
            <div class="schema-delete" role="group" aria-label={`Confirm deletion of ${metadata.title}`}>
              <p>Delete this document and its local history? Saved workflows are retained, but operations from this document will become unavailable.</p>
              <div class="confirmation-actions">
                <Button size="sm" variant="secondary" disabled={working} onclick={() => deletingId = null}>Cancel</Button>
                <Button size="sm" disabled={mutationsDisabled} onclick={() => run(`Deleting ${metadata.title}…`, () => onDelete(record.id))}>Delete</Button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if dragSurfaceActive}<div class="schema-drag-surface" aria-hidden="true"></div>{/if}
    </div>
  {:else if ready && !working && !displayedError}
    <div class="schema-empty"><h3>No OpenAPI documents yet</h3><p>Upload a JSON or YAML document to make its operations available.</p></div>
  {/if}
</section>

<style>
  .schema-settings { --color-secondary-hover: var(--color-background); --color-secondary-hover-foreground: var(--color-foreground); display: grid; gap: 12px; min-width: 0; padding: 16px; color: var(--color-catalog-active-foreground); container-type: inline-size; }
  .schema-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
  .schema-upload-guidance { flex: 1 1 240px; min-width: 0; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .schema-status { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .schema-toolbar :global(.upload-action) { height: auto; min-height: 44px; max-width: 100%; padding-block: 12px; white-space: normal; text-align: left; font-weight: 700; background: var(--color-background); color: var(--color-foreground); }
  .schema-list { position: relative; display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
  .schema-drag-area { position: relative; min-width: 0; }
  .schema-drag-surface { position: absolute; inset: 0; z-index: 3; }
  .schema-toolbar, .schema-card, .schema-empty { min-width: 0; padding: 16px; border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); }
  .schema-heading { --schema-control-size: calc(var(--spacing) * 8); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .schema-name { display: flex; flex: 1; min-width: min(100%, 180px); height: var(--schema-control-size); border-radius: 4px; background: var(--color-background); color: var(--color-foreground); outline: 3px solid transparent; outline-offset: 3px; transition: outline-color 180ms ease-in; }
  .schema-name:focus-within { outline-color: var(--color-ring); }
  .schema-name-icon { display: grid; place-items: center; flex: 0 0 var(--schema-control-size); width: var(--schema-control-size); height: 100%; cursor: text; }
  .schema-name-input { box-sizing: border-box; min-width: 0; width: 100%; height: 100%; padding: 6px 10px; border: 0; border-radius: 0 4px 4px 0; outline: none; background: transparent; color: inherit; font-size: 14px; }
  .schema-empty h3 { margin: 0; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
  .schema-empty p, .schema-note { margin: 6px 0 0; color: var(--color-muted-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .schema-actions { --schema-action-gap: 6px; display: flex; align-items: center; flex-wrap: wrap; gap: var(--schema-action-gap); }
  .schema-card { position: relative; }
  .schema-card :global(.schema-disclosure > summary) { padding-left: 12px; font-size: 12px; }
  .schema-card :global(.schema-disclosure > summary > .schema-chevron) { width: auto; margin-left: 0; }
  .schema-settings :global(.schema-action:is(:hover,:focus-visible):enabled) { background: transparent; color: inherit; }
  .schema-card.dragging { opacity: 0.5; }
  .schema-actions :global(.schema-drag-handle) { cursor: grab; }
  .schema-actions :global(.schema-drag-handle:active) { cursor: grabbing; }
  .schema-metadata { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); gap: 12px; margin: 18px 0; }
  .schema-metadata > div { min-width: 0; padding: 8px 10px; border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-background); }
  .schema-metadata dt { margin-bottom: 5px; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
  .schema-metadata dd { min-width: 0; margin: 0; font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .schema-enabled { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 0 0 auto; height: var(--schema-control-size); width: calc(var(--schema-control-size) * 4 + var(--schema-action-gap) * 3); padding: 4px 8px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 12px; font-weight: 700; text-align: left; }
  .default-switch { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .schema-enabled[aria-checked="true"] .default-switch { background: var(--color-catalog-active); }
  .schema-enabled[aria-checked="true"] .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .schema-error { display: grid; justify-items: start; gap: 10px; }
  .schema-error p { width: 100%; box-sizing: border-box; margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
  .schema-delete { display: grid; gap: 12px; margin-top: 16px; padding: 12px; border-radius: 4px; background: var(--color-background); }
  .schema-delete p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .confirmation-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
  @container (max-width: 430px) { .schema-metadata { grid-template-columns: 1fr; } }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .schema-settings :global(.schema-action:hover:enabled), .schema-enabled:hover:enabled { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
  }
  @media (prefers-reduced-motion: reduce) { .schema-name, .default-switch, .default-switch > span { transition: none; } }
  @media (forced-colors: active) { .schema-name:not(:focus-within) { outline-style: none; } }
</style>
