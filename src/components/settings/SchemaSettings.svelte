<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import JsonSchemaView from "$lib/components/JsonSchemaView.svelte";
  import Reveal from "$lib/components/Reveal.svelte";
  import Disclosure from "$lib/components/Disclosure.svelte";
  import { schemaNameParts } from "$lib/catalog-hierarchy.ts";
  import { schemaNameTree, type SchemaNameNode } from "$lib/schema-name-tree.ts";
  import SchemaHistory from "./SchemaHistory.svelte";
  import type { SchemaLibraryRecord } from "$lib/schema-library-types.ts";
  import type { SchemaBranchHistory, SchemaRevisionDiff } from "$lib/schema-storage.ts";
  import type { SchemaFieldDiff } from "$lib/schema-diff.ts";
  import type { SchemaResolution } from "$lib/schema-merge.ts";
  import { schemaDeletionReason } from "$lib/schema-deletion.ts";

  let { records, busy = false, ready = true, error = "", onUpload, onReplace, onRename, onEnabledChange, onDelete, onDownload, onRetry, onLoad, onRelease,
    onHistory, onDiff, onFieldDiff, onResolveUpdate, onDismissUpdate }: {
    records: SchemaLibraryRecord[];
    busy?: boolean;
    ready?: boolean;
    error?: string;
    onUpload: (file: File) => Promise<void>;
    onReplace: (id: string, file: File) => Promise<void>;
    onRename: (id: string, name: string) => Promise<void>;
    onEnabledChange: (id: string, enabled: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onDownload: (record: SchemaLibraryRecord) => void;
    onRetry: () => Promise<void>;
    onLoad: (id: string) => Promise<Record<string, unknown>>;
    onRelease: (id: string) => void;
    onHistory?: (id: string, limit: number) => Promise<SchemaBranchHistory>;
    onDiff?: (id: string, oid: string, limit: number, base?: string) => Promise<SchemaRevisionDiff>;
    onFieldDiff?: (id: string, oid: string, base: string | undefined, path: string, limit: number) => Promise<SchemaFieldDiff>;
    onResolveUpdate?: (id: string, current: string, incoming: string, choices: Record<string, SchemaResolution>) => Promise<void>;
    onDismissUpdate?: (id: string, current: string, incoming: string) => Promise<void>;
  } = $props();

  let uploadInput: HTMLInputElement;
  let replaceInput: HTMLInputElement;
  let replacingId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let nameDrafts = $state<Record<string, string | undefined>>({});
  let expandedCards = $state<Record<string, boolean>>({});
  let expandedGroups = $state<Record<string, boolean>>({});
  const tree = $derived(schemaNameTree(records));
  const queuedNames = new Map<string, { name: string }>();
  let renaming = $state(0);
  let pending = $state<string | null>(null);
  let actionError = $state("");
  const working = $derived((busy && renaming === 0) || pending !== null);
  const mutationsDisabled = $derived(working || !ready);
  const displayedError = $derived(actionError || error);
  const acceptedFiles = ".json,.yaml,.yml,application/json,application/yaml,text/yaml";
  $effect(() => {
    if (!deletingId) return;
    const record = records.find(record => record.id === deletingId);
    if (!record || schemaDeletionReason(record)) deletingId = null;
  });
  function details(record: SchemaLibraryRecord) {
    return {
      title: record.summary.name,
      description: record.summary.description,
      operations: record.summary.operationCount
    };
  }

  function toggleCard(id: string) {
    expandedCards[id] = !expandedCards[id];
    if (!expandedCards[id] && deletingId === id) deletingId = null;
  }

  function revealName(name: string) {
    const parts = schemaNameParts(name);
    for (let depth = 1; depth < parts.length; depth++) expandedGroups[JSON.stringify(parts.slice(0, depth))] = true;
  }

  function toggleGroup(node: Extract<SchemaNameNode<SchemaLibraryRecord>, { kind: "group" }>, open: boolean) {
    expandedGroups[node.id] = open;
    if (open) return;
    function close(nodes: SchemaNameNode<SchemaLibraryRecord>[]) {
      for (const child of nodes) {
        if (child.kind === "group") { expandedGroups[child.id] = false; close(child.children); }
        else {
          expandedCards[child.id] = false;
          if (deletingId === child.id) deletingId = null;
        }
      }
    }
    close(node.children);
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
      revealName(name);
      await onRename(id, name);
      if (queuedNames.get(id) === request && nameDrafts[id] === draft) delete nameDrafts[id];
    }
    catch (failure) { actionError = failure instanceof Error ? failure.message : "Could not save the schema name. Please try again."; }
    finally {
      if (queuedNames.get(id) === request) queuedNames.delete(id);
      renaming -= 1;
    }
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
    <ul class="schema-list">
      {@render treeRows(tree)}
    </ul>
  {:else if ready && !working && !displayedError}
    <div class="schema-empty"><h3>No OpenAPI documents yet</h3><p>Upload a JSON or YAML document to make its operations available.</p></div>
  {/if}
</section>

{#snippet treeRows(nodes: SchemaNameNode<SchemaLibraryRecord>[])}
  {#each nodes as node (`${node.kind}:${node.id}`)}
    {#if node.kind === "group"}
      <li class="schema-group tree-branch" data-schema-group={node.id}>
        <Disclosure class="schema-name-group" label={`Schema group: ${node.path.join(" / ")}`} tooltipEnabled={false}
          open={expandedGroups[node.id] ?? false} onToggle={next => toggleGroup(node, next)}>
          {#snippet summary()}
            <MaterialIcon name="keyboard_arrow_right" class="schema-group-chevron" size={18} />
            <span class="schema-group-label">{node.name}</span>
          {/snippet}
          <ul class="schema-children tree-children">{@render treeRows(node.children)}</ul>
        </Disclosure>
      </li>
    {:else}
      {@render schemaCard(node.record, node.name)}
    {/if}
  {/each}
{/snippet}

{#snippet schemaCard(record: SchemaLibraryRecord, leafName: string)}
  {@const metadata = details(record)}
  {@const deletionReason = schemaDeletionReason(record)}
  <li class="schema-card tree-branch" data-schema-id={record.id}>
    <div class="schema-heading">
      <div class="schema-name">
        <HintButton class="schema-card-toggle" aria-label={`Schema details: ${metadata.title}`}
          aria-expanded={expandedCards[record.id] ?? false} aria-controls={`schema-details-${record.id}`}
          label={expandedCards[record.id] ? "Hide schema details" : "Show schema details"} labelAsName={false} onclick={() => toggleCard(record.id)}>
          <MaterialIcon name="keyboard_arrow_right" size={18} />
        </HintButton>
        <div class="schema-name-field" class:editing={expandedCards[record.id] ?? false}>
          {#if expandedCards[record.id]}
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
          {:else}
            <button class="schema-name-label" type="button" aria-label={`Open schema: ${metadata.title}`} aria-expanded="false" aria-controls={`schema-details-${record.id}`}
              onclick={event => {
                event.currentTarget.closest(".schema-heading")?.querySelector<HTMLButtonElement>(".schema-card-toggle")?.focus({ preventScroll: true });
                toggleCard(record.id);
              }}>{leafName}</button>
          {/if}
          <label class="schema-name-icon" class:visible={expandedCards[record.id] ?? false} for={`schema-name-${record.id}`}
            aria-hidden={!expandedCards[record.id]} inert={!expandedCards[record.id]}><MaterialIcon name="edit_line" size={20} /><span class="sr-only">Schema name</span></label>
        </div>
        <HintButton class="schema-enabled" role="switch" aria-label={`Enable ${metadata.title}`} aria-checked={record.enabled}
          label={record.enabled ? "Disable schema" : "Enable schema"} labelAsName={false} disabled={mutationsDisabled}
          onclick={() => run("", () => onEnabledChange(record.id, !record.enabled))}>
          <span class="default-switch" aria-hidden="true"><span></span></span>
        </HintButton>
      </div>
    </div>

    <Reveal open={expandedCards[record.id] ?? false} id={`schema-details-${record.id}`} overflowVisible>
      <div class="schema-metadata">
        <div class="schema-description"><p>{metadata.description || "—"}</p></div>
        <div class="schema-operation-count"><dl><dt>Operations</dt><dd>
          {#if metadata.operations !== null && record.summary.unavailableCount}
            <HintButton label={`${(metadata.operations - record.summary.unavailableCount).toLocaleString()} of ${metadata.operations.toLocaleString()} operations supported.`} labelAsName={false}>
              {#snippet child({ props })}
                {@const { type: _type, disabled: _disabled, ...hintProps } = props}
                <span {...hintProps}>{metadata.operations?.toLocaleString() ?? "—"}</span>
              {/snippet}
            </HintButton>
          {:else}{metadata.operations?.toLocaleString() ?? "—"}{/if}
        </dd></dl></div>
      </div>

      <Reveal open={!record.enabled} id={`schema-disabled-${record.id}`}><p class="schema-note">Operations from this document are unavailable until it is enabled.</p></Reveal>

      <JsonSchemaView load={() => onLoad(record.id)} onRelease={() => onRelease(record.id)} sourceKey={record.sourceIdentity}
        title={record.summary.protocol === "json-rpc" ? "Codex App Server schema" : "OpenAPI schema"}
        label={`Full ${record.summary.protocol === "json-rpc" ? "JSON-RPC" : "OpenAPI"} JSON: ${metadata.title}`} operationsOnly pageSize={1000} validated>
        {#snippet actions()}
          <span class="schema-actions" role="group" aria-label={`Actions for ${metadata.title}`}>
            <HintButton class="schema-action" label={`Replace ${metadata.title}`} labelAsName={false} aria-label={`Replace ${metadata.title}`} disabled={mutationsDisabled} onclick={() => chooseReplacement(record.id)}>
              <MaterialIcon name="upload_file" size={20} />
            </HintButton>
            <HintButton class="schema-action" label="Download schema" labelAsName={false} aria-label={`Download ${metadata.title}`} disabled={working} onclick={() => onDownload(record)}>
              <MaterialIcon name="download" size={20} />
            </HintButton>
            <HintButton class="schema-action" label={deletionReason ?? `Delete ${metadata.title}`} labelAsName={false} aria-label={`Delete ${metadata.title}`}
              disabled={mutationsDisabled || Boolean(deletionReason) || deletingId === record.id}
              onclick={() => { if (!deletionReason) deletingId = record.id; }}>
              <MaterialIcon name="delete" size={20} class="schema-delete-icon" />
            </HintButton>
          </span>
        {/snippet}
      </JsonSchemaView>

      {#if onHistory && onDiff && onFieldDiff}
        <SchemaHistory id={record.id} sourceIdentity={record.sourceIdentity} pending={record.hasPendingUpdate}
          load={limit => onHistory!(record.id, limit)} loadDiff={(oid, limit, base) => onDiff!(record.id, oid, limit, base)}
          loadFieldDiff={(oid, base, path, limit) => onFieldDiff!(record.id, oid, base, path, limit)}
          onResolve={onResolveUpdate ? (current, incoming, choices) => onResolveUpdate!(record.id, current, incoming, choices) : undefined}
          onDismiss={onDismissUpdate ? (current, incoming) => onDismissUpdate!(record.id, current, incoming) : undefined} />
      {/if}

      {#if deletingId === record.id && !deletionReason}
        <div class="schema-delete" role="group" aria-label={`Confirm deletion of ${metadata.title}`}>
          <p>Delete this document and its local history? Saved workflows are retained, but operations from this document will become unavailable.</p>
          <div class="confirmation-actions">
            <Button size="sm" variant="secondary" disabled={working} onclick={() => deletingId = null}>Cancel</Button>
            <Button size="sm" disabled={mutationsDisabled} onclick={() => run(`Deleting ${metadata.title}…`, () => onDelete(record.id))}>Delete</Button>
          </div>
        </div>
      {/if}
    </Reveal>
  </li>
{/snippet}

<style>
  .schema-settings { --color-secondary-hover: var(--color-background); --color-secondary-hover-foreground: var(--color-foreground); display: grid; gap: 12px; min-width: 0; padding: 16px; color: var(--color-catalog-active-foreground); container-type: inline-size; }
  .schema-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
  .schema-upload-guidance { flex: 1 1 240px; min-width: 0; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .schema-status { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .schema-toolbar :global(.upload-action) { height: auto; min-height: 44px; max-width: 100%; padding-block: 12px; white-space: normal; text-align: left; font-weight: 700; background: var(--color-background); color: var(--color-foreground); }
  .schema-list { --schema-control-size: calc(var(--spacing) * 8); --schema-label-gap: 6px; --schema-indent: 12px; --tree-indent: var(--schema-indent); --tree-line-inset: calc(var(--schema-indent) * 0.6); --tree-hook-top: 9px; display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
  .schema-toolbar, .schema-list, .schema-empty { min-width: 0; padding: 16px; border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); }
  .schema-group { min-width: 0; }
  .schema-children { display: grid; gap: 12px; margin: 0; padding: 12px 0 0; list-style: none; }
  .schema-settings :global(.schema-name-group > summary) { display: flex; align-items: center; gap: var(--schema-label-gap); min-height: 32px; padding: 6px 10px 6px 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); list-style: none; font-size: 14px; font-weight: 700; }
  .schema-group-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .schema-settings :global(.schema-group-chevron) { flex-shrink: 0; width: var(--schema-control-size); margin-left: 0; text-align: center; transition: transform 180ms ease-in-out; }
  .schema-settings :global(.schema-name-group > summary[aria-expanded="true"] .schema-group-chevron) { transform: rotate(90deg); }
  .schema-heading { display: flex; align-items: center; gap: 6px; }
  .schema-name { display: flex; flex: 1; min-width: 0; height: var(--schema-control-size); border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  .schema-name-field { position: relative; display: flex; flex: 1; min-width: 0; height: 100%; padding-right: 0; transition: padding-right 180ms ease-in-out; }
  .schema-name-field.editing { padding-right: var(--schema-control-size); }
  .schema-name-icon { position: absolute; top: 0; right: 0; display: grid; place-items: center; width: var(--schema-control-size); height: 100%; cursor: text; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 180ms ease-in-out, visibility 0s linear 180ms; }
  .schema-name-icon.visible { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
  .schema-name-input, .schema-name-label { box-sizing: border-box; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 6px 10px 6px var(--schema-label-gap); border: 0; border-radius: 0; outline: none; background: transparent; color: inherit; font-size: 14px; }
  .schema-name-label { overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
  .schema-empty h3 { margin: 0; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
  .schema-empty p, .schema-note { margin: 6px 0 0; color: var(--color-muted-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .schema-note { color: var(--color-accent); }
  .schema-actions { display: flex; align-items: center; flex-shrink: 0; gap: 6px; }
  /* Match the four persistent JSON actions (28px each), their 6px gaps and the 14px header inset. */
  .schema-card { --schema-count-width: calc(4 * 28px + 3 * 6px + 14px); position: relative; min-width: 0; }
  .schema-card > :global(.reveal-panel) { margin-left: var(--schema-indent); transition-timing-function: ease-in-out, linear; }
  .schema-card :global(.schema-disclosure > summary) { flex-wrap: wrap; gap: 6px; padding-left: 12px; font-size: 12px; }
  .schema-card :global(.schema-disclosure > summary > .schema-chevron) { width: auto; margin-left: 0; }
  .schema-card :global(.schema-card-toggle) { display: grid; place-items: center; flex: 0 0 var(--schema-control-size); height: 100%; padding: 0; border: 0; border-radius: 4px 0 0 4px; background: transparent; color: inherit; }
  .schema-card :global(.schema-card-toggle .material-symbols-rounded) { transition: transform 180ms ease-in-out, scale 180ms ease-in-out; }
  .schema-card :global(.schema-card-toggle[aria-expanded="true"] .material-symbols-rounded) { transform: rotate(90deg); }
  .schema-settings :global(.schema-action:is(:hover,:focus-visible):enabled) { background: transparent; color: inherit; }
  .schema-settings :global(.schema-action:disabled .schema-delete-icon) { opacity: 0.5; }
  .schema-metadata { display: grid; grid-template-columns: minmax(0, 1fr) var(--schema-count-width); gap: 12px; margin: 18px 0; }
  .schema-metadata > div { min-width: 0; padding: 8px 10px; border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-background); }
  .schema-operation-count { box-sizing: border-box; justify-self: end; width: var(--schema-count-width); max-width: 100%; }
  .schema-description { box-sizing: border-box; display: flex; align-items: center; min-height: 52px; }
  .schema-description p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; min-width: 0; width: 100%; max-height: 3em; margin: 0; overflow: hidden; text-overflow: ellipsis; overflow-wrap: anywhere; white-space: normal; font-size: 12px; font-weight: 400; line-height: 1.5; }
  .schema-metadata dl { margin: 0; }
  .schema-metadata dt { margin-bottom: 5px; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
  .schema-metadata dd { min-width: 0; margin: 0; font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .schema-heading :global(.schema-enabled) { display: flex; align-items: center; justify-content: center; flex: 0 0 56px; height: 100%; padding: 4px 8px; border: 0; border-radius: 0 4px 4px 0; background: transparent; color: inherit; }
  .default-switch { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in, transform 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  :global(.schema-enabled[aria-checked="true"]) .default-switch { background: var(--color-catalog-active); }
  :global(.schema-enabled[aria-checked="true"]) .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .schema-error { display: grid; justify-items: start; gap: 10px; }
  .schema-error p { width: 100%; box-sizing: border-box; margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
  .schema-delete { display: grid; gap: 12px; margin-top: 16px; padding: 12px; border-radius: 4px; background: var(--color-background); }
  .schema-delete p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  .confirmation-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
  @container (max-width: 430px) { .schema-metadata { grid-template-columns: 1fr; } .schema-list { --schema-indent: 8px; } }
  @media (prefers-reduced-motion: reduce) { .schema-settings :global(.schema-group-chevron) { transition: none; } }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .schema-card :global(.schema-disclosure > summary:hover) { transform: scale(min(1.06, var(--hover-scale, 1.06))); }
    .schema-settings :global(.schema-action:hover:enabled) { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
    .schema-card :global(.schema-card-toggle:hover .material-symbols-rounded) { scale: 1.10; }
    :global(.schema-enabled:hover:enabled) .default-switch { transform: scale(1.10); }
  }
  @media (prefers-reduced-motion: reduce) { .schema-name-field, .schema-name-icon, .default-switch, .default-switch > span, .schema-card :global(.schema-card-toggle .material-symbols-rounded) { transition: none; } }
</style>
