<script lang="ts">
  import { onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Disclosure from "$lib/components/Disclosure.svelte";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import type { Operation } from "$lib/catalog.ts";
  import type { WorkspaceMode } from "$lib/workspace.d.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import WorkspaceSelector from "./WorkspaceSelector.svelte";
  import CatalogPrompt from "./CatalogPrompt.svelte";
  import { catalogs, type CatalogGroup } from "$lib/catalog-registry.ts";
  import { evaluateOperationsAsync } from "$lib/operation-matching-client.ts";
  import type { OperationMatch } from "$lib/matching.ts";
  let { open = $bindable(false), modal = $bindable(false), documentModal = false, operations, mode, dark, workflows, workflowError, onWorkflowSelect, onWorkflowRetry, onSelect, onMode, onTheme }:
    { open: boolean; modal?: boolean; documentModal?: boolean; operations: Operation[]; mode: WorkspaceMode; dark: boolean;
      workflows: WorkflowDocument[]; workflowError: string; onWorkflowSelect: (document: WorkflowDocument) => void; onWorkflowRetry: () => void;
      onSelect: (operation: Operation) => void; onMode: (mode: WorkspaceMode) => void; onTheme: () => void } = $props();
  let mobile = $state(false);
  let catalogPath = $state<string[]>([]);
  let workflowsOpen = $state(false);
  let navigation = $state<HTMLElement>();
  let promptEditor: CatalogPrompt;
  let promptFocusRequested = false;
  let sheetAutoFocused = false;
  let prompt = $state("");
  let composing = $state(false);
  let matchingOpen = $state(false);
  let matchingPending = $state(false);
  let matchingError = $state("");
  let evaluation = $state<{ prompt: string; candidates: OperationMatch[]; results: OperationMatch[]; durationMs: number } | null>(null);
  let searchExpansion = $state<Record<string, boolean>>({});
  let retryMatching = $state(0);
  let matchingController: AbortController | undefined;
  let matchingTimer: ReturnType<typeof setTimeout> | undefined;
  let matchingRevision = 0;
  const matchingIds = $derived(prompt.trim() ? new Set(evaluation?.results.map(result => result.operation.id) ?? []) : null);
  let destination: (() => void) | null = null;
  let restoreNavigationFocus = false;
  const groups: CatalogGroup[] = $derived.by(() => {
    // The operation snapshot changes together with the registered source documents.
    void operations;
    return catalogs.flatMap(catalog => catalog.groups);
  });
  function groupOperations(group: CatalogGroup, filtered = true) {
    return operations.filter(operation => group.operationIds?.includes(operation.id) && (!filtered || !matchingIds || matchingIds.has(operation.id)));
  }
  function groupCount(group: CatalogGroup, filtered = false): number {
    return groupOperations(group, filtered).length + (group.children ?? []).reduce((count, child) => count + groupCount(child, filtered), 0);
  }
  function togglePath(depth: number, id: string, next: boolean) {
    catalogPath = next ? [...catalogPath.slice(0, depth), id] : catalogPath.slice(0, depth);
  }
  function toggleGroup(depth: number, path: string[], next: boolean) {
    if (matchingIds) searchExpansion = { ...searchExpansion, [JSON.stringify(path)]: next };
    else togglePath(depth, path[depth]!, next);
  }
  function cancelMatching() {
    matchingRevision += 1;
    if (matchingTimer !== undefined) clearTimeout(matchingTimer);
    matchingTimer = undefined;
    matchingController?.abort();
    matchingController = undefined;
  }
  function changePrompt(value: string, isComposing = false) {
    // Input events abort immediately, before the reactive debounce is scheduled.
    cancelMatching();
    prompt = value;
    composing = isComposing;
    evaluation = null;
    matchingError = "";
    matchingPending = Boolean(value.trim());
    retryMatching += 1;
  }
  export async function focusPrompt() {
    promptFocusRequested = true;
    await tick();
    const target = promptEditor?.focus();
    if (!mobile || sheetAutoFocused) promptFocusRequested = false;
    return target;
  }
  $effect.pre(() => {
    const query = prompt;
    const snapshot = operations;
    const isComposing = composing;
    void retryMatching;
    cancelMatching();
    evaluation = null;
    matchingError = "";
    searchExpansion = {};
    matchingPending = Boolean(query.trim());
    if (!query.trim() || isComposing) return;
    const controller = new AbortController();
    matchingController = controller;
    const revision = matchingRevision;
    matchingTimer = setTimeout(() => {
      matchingTimer = undefined;
      void evaluateOperationsAsync(query, snapshot, controller.signal).then(result => {
        if (controller.signal.aborted || revision !== matchingRevision) return;
        evaluation = { prompt: query, ...result };
        matchingPending = false;
      }).catch((cause: unknown) => {
        if (controller.signal.aborted || revision !== matchingRevision) return;
        matchingError = cause instanceof Error ? cause.message : "Could not evaluate operations. Try again.";
        matchingPending = false;
      });
    }, 150);
    return cancelMatching;
  });
  $effect(() => {
    if (mobile && documentModal) open = false;
    if (mobile && open && !documentModal) {
      modal = true;
      // Reopening interrupts dismissal and cancels its pending destination.
      destination = null;
      restoreNavigationFocus = false;
    }
    // Breakpoint changes unmount the Sheet without running its exit animation.
    else if (modal && (!mobile || documentModal)) void finishClose();
  });
  $effect(() => {
    const visible = open;
    const desktop = !mobile;
    const panel = navigation;
    let cancelled = false;
    if (visible && desktop && panel && !documentModal) {
      const origin = document.activeElement;
      void tick().then(() => {
        if (!cancelled && open && !mobile && !documentModal && navigation === panel && document.activeElement === origin) {
          workspaceFocusTarget(panel)?.focus();
        }
      });
    }
    else if (!visible && !documentModal && navigation?.contains(document.activeElement)) focusMenu();
    return () => { cancelled = true; };
  });
  onMount(() => {
    const media = matchMedia("(max-width: 899px)");
    const update = () => {
      const hadFocus = navigation?.contains(document.activeElement) || Boolean(document.activeElement?.closest('[data-slot="sheet-content"]'));
      if (media.matches && documentModal) open = false;
      mobile = media.matches;
      if (hadFocus && mobile && !documentModal) void tick().then(() => {
        if (!open || !mobile || documentModal) return;
        const panel = document.getElementById("side-navigation");
        (workspaceFocusTarget(panel) ?? document.querySelector<HTMLElement>('[aria-controls="side-navigation"]'))?.focus();
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (!mobile && open && event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="tooltip"], [role="menu"]')) {
        open = false; event.preventDefault();
      }
    };
    update(); media.addEventListener("change", update); document.addEventListener("keydown", escape);
    return () => { media.removeEventListener("change", update); document.removeEventListener("keydown", escape); };
  });
  function focusMenu() {
    document.querySelector<HTMLElement>('[aria-controls="side-navigation"]')?.focus({ preventScroll: true });
  }
  function workspaceFocusTarget(panel: HTMLElement | null | undefined) {
    return panel?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>("button");
  }
  async function finishClose() {
    // Presence completion precedes DOM removal; release graph shortcuts afterward.
    await tick();
    if (mobile && open && !documentModal) return;
    promptFocusRequested = false;
    sheetAutoFocused = false;
    modal = false;
    await tick();
    const next = destination;
    const restoreFocus = restoreNavigationFocus;
    destination = null;
    restoreNavigationFocus = false;
    if (open || documentModal) return;
    if (next) next();
    else if (restoreFocus) focusMenu();
  }
  function navigate(action: () => void) {
    if (mobile) { destination = action; open = false; }
    else action();
  }
  function select(operation: Operation) { navigate(() => onSelect(operation)); }
  function changeMode(next: WorkspaceMode) { if (next !== mode) navigate(() => onMode(next)); }
</script>

{#snippet branch(group: CatalogGroup, depth: number, parentOpen: boolean, parents: string[] = [])}
  {@const count = groupCount(group)}
  {@const path = [...parents, group.id]}
  {@const expanded = parentOpen && (matchingIds ? (searchExpansion[JSON.stringify(path)] ?? groupCount(group, true) > 0) : catalogPath[depth] === group.id)}
  {#if groupCount(group, true) > 0}
    <div class="catalog-branch" data-catalog-group={group.id}>
      <Disclosure class="catalog-group" label={`${group.name} group, ${count} operations`} tooltipEnabled={false} open={expanded} onToggle={(next) => toggleGroup(depth, path, next)}>
        {#snippet summary()}<span class="catalog-name">{group.name}</span><span class="catalog-count" aria-label={`${count} operations`}><span class="catalog-count-value">{count}</span></span><MaterialIcon name="chevron_forward" size={17} />{/snippet}
        {#if group.children?.length}
          <div class="catalog-children">
            {#each group.children as child (child.id)}{@render branch(child, depth + 1, expanded, path)}{/each}
          </div>
        {/if}
        {@const entries = groupOperations(group)}
        {#if entries.length}
          <ul class="catalog-operations">
            {#each entries as operation (operation.id)}
              <li data-operation-id={operation.id} data-operation-name={operation.name}>
                <button class="catalog-operation-action" type="button" aria-label={`Add to workflow: ${operation.name}`}
                  onclick={() => { togglePath(depth + 1, operation.id, true); select(operation); }}>
                  <span class="catalog-name">{operation.name}</span>
                  <HintButton label="Add to workflow" labelAsName={false} tooltipSide="right">
                    {#snippet child({ props })}
                      {@const { type: _type, tabindex: _tabindex, ...iconProps } = props}
                      <span {...iconProps} class="catalog-action-icon"><MaterialIcon name="add_box" size={24} /></span>
                    {/snippet}
                  </HintButton>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </Disclosure>
    </div>
  {/if}
{/snippet}

{#snippet catalog()}
  <div class="catalog-menu-header">
    <WorkspaceSelector {mode} onMode={changeMode} />
    <HintButton class="icon-switch" type="button" role="switch" label={dark ? "Switch to light theme" : "Switch to dark theme"} aria-label="Dark theme" aria-checked={dark}
      onclick={onTheme}>
      <span class="switch-thumb"></span><span><MaterialIcon name="light_mode" /></span><span><MaterialIcon name="dark_mode" /></span>
    </HintButton>
  </div>
  <CatalogPrompt bind:this={promptEditor} value={prompt} pending={matchingPending} error={matchingError} {evaluation}
    {matchingOpen} onChange={changePrompt}
    onMatchingToggle={() => matchingOpen = !matchingOpen} onRetry={() => retryMatching += 1} />
  <nav class="operation-catalog" aria-label="Operation catalog">
    {#each groups.filter(group => groupCount(group, true) > 0) as group (group.id)}
      <div class="catalog-reorder" animate:flip={{ duration: () => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 }}>
        {@render branch(group, 0, true)}
      </div>
    {/each}
  </nav>
  <nav class="operation-catalog workflow-catalog" aria-label="Saved workflow catalog">
    <Disclosure class="catalog-group" label={`Workflows, ${workflows.length} saved`} tooltipEnabled={false} open={workflowsOpen} onToggle={(next) => workflowsOpen = next}>
      {#snippet summary()}<span class="catalog-name">Workflows</span><span class="catalog-count" aria-label={`${workflows.length} workflows`}><span class="catalog-count-value">{workflows.length}</span></span><MaterialIcon name="chevron_forward" size={17} />{/snippet}
      {#if workflowError}
        <p role="alert" class="hint">{workflowError}</p><button type="button" class="text-button" onclick={onWorkflowRetry}>Retry</button>
      {:else if !workflows.length}<p class="hint">Save a workflow to use it here.</p>{/if}
      <ul class="catalog-operations">
        {#each workflows as workflow (workflow.id)}
          <li data-workflow-id={workflow.id}>
            <button class="catalog-operation-action" type="button" aria-label={`Add to workflow: ${workflow.name}`}
              onclick={() => navigate(() => onWorkflowSelect(workflow))}>
              <span class="catalog-name">{workflow.name}</span>
              <HintButton label="Add to workflow" labelAsName={false} tooltipSide="right">
                {#snippet child({ props })}
                  {@const { type: _type, tabindex: _tabindex, ...iconProps } = props}
                  <span {...iconProps} class="catalog-action-icon"><MaterialIcon name="add_box" size={24} /></span>
                {/snippet}
              </HintButton>
            </button>
          </li>
        {/each}
      </ul>
    </Disclosure>
  </nav>
{/snippet}

{#if mobile}
  {#if !documentModal}
  <Sheet.Root bind:open onOpenChangeComplete={(next) => { if (!next) void finishClose(); }}>
    <Sheet.Content id="side-navigation" class="catalog-sheet" side="left" aria-label="Navigation" onOpenAutoFocus={(event) => {
      event.preventDefault();
      sheetAutoFocused = true;
      if (promptFocusRequested) {
        promptFocusRequested = false;
        promptEditor?.focus();
      } else workspaceFocusTarget(document.getElementById("side-navigation"))?.focus();
    }} onCloseAutoFocus={(event) => {
      event.preventDefault();
      restoreNavigationFocus = !destination;
    }}>
      <Sheet.Header class="sr-only"><Sheet.Title>Operations catalog</Sheet.Title>
        <Sheet.Description>Browse operations and change your workspace or theme.</Sheet.Description></Sheet.Header>
      {@render catalog()}
    </Sheet.Content>
  </Sheet.Root>
  {/if}
{:else}
  <aside bind:this={navigation} id="side-navigation" class="catalog-menu" class:open aria-label="Navigation" inert={!open}>
    {@render catalog()}
  </aside>
{/if}

<style>
  .catalog-menu { transition: transform 200ms ease-in, visibility 0s linear 200ms; }
  .catalog-menu.open { transition-delay: 0s; }
  .operation-catalog { isolation: isolate; }
  .catalog-reorder + .catalog-reorder { margin-top: 12px; }
  .workflow-catalog { margin-top: 12px; }
  /* Keep headings above ancestor and sibling connectors throughout hover exit too. */
  .operation-catalog :global(summary), .operation-catalog :global(.catalog-operation-action) { position: relative; z-index: 1; }
  .operation-catalog :global(summary),
  .operation-catalog :global(button) {
    transition: background-color 180ms ease-in, border-color 180ms ease-in, color 180ms ease-in,
      transform 180ms ease-in, opacity 180ms ease-in, outline-color 180ms ease-in;
  }
  .catalog-name { display: inline-block; }
  .operation-catalog :global(summary > .material-symbols-rounded),
  .operation-catalog :global(.catalog-open-operation .material-symbols-rounded) {
    transition: transform 180ms ease-in, color 180ms ease-in;
  }

  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .operation-catalog :global(summary:not([inert] *)),
    .operation-catalog :global(.catalog-operation-action:not([inert] *)),
    .operation-catalog :global(.catalog-open-operation:not(:disabled):not([inert] *)) { will-change: transform; }
    .operation-catalog :global(summary:hover), .operation-catalog :global(.catalog-operation-action:hover) { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
    .operation-catalog :global(.catalog-operation-detail:hover .catalog-open-operation) { transform: scale(min(1.16, var(--hover-scale, 1.16))); }
  }

  @media (prefers-reduced-motion: reduce) {
    .catalog-menu, .catalog-name,
    .operation-catalog :global(summary), .operation-catalog :global(button),
    .operation-catalog :global(.material-symbols-rounded) { transition: none; }
  }
</style>
