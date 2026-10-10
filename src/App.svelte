<script lang="ts">
  import { tick } from "svelte";
  import { Tooltip } from "bits-ui";
  import { operations, type Operation } from "$lib/catalog.ts";
  import type { WorkspaceMode } from "$lib/workspace.d.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import Header from "./components/Header.svelte";
  import SideNavigation from "./components/SideNavigation.svelte";
  import OperationsWorkspace from "./components/OperationsWorkspace.svelte";
  import WorkflowWorkspace from "./components/WorkflowWorkspace.svelte";
  import SettingsWorkspace, { palettes } from "./components/SettingsWorkspace.svelte";
  import BackgroundWave from "./components/BackgroundWave.svelte";
  import NativeScrollbars from "./components/NativeScrollbars.svelte";

  let navigationOpen = $state(false);
  let navigationModal = $state(false);
  let documentModal = $state(false);
  let savedWorkflows = $state<WorkflowDocument[]>([]);
  let workflowLibraryError = $state("");
  let mode = $state<WorkspaceMode>("operations");
  let dark = $state(document.documentElement.dataset.theme === "dark");
  let palette = $state(palettes.find(option => option.id === document.documentElement.dataset.palette)?.id ?? palettes[0].id);
  let operationsWorkspace: OperationsWorkspace;
  let sideNavigation: SideNavigation;
  let workflowWorkspace: WorkflowWorkspace;
  let settingsWorkspace: SettingsWorkspace;

  let operationsHost: HTMLDivElement;
  let lastOperationsFocus: HTMLElement | undefined;
  let operationsScroll = 0;

  async function focusDestination() {
    await tick();
    if (navigationModal) return;
    if (mode === "workflow") workflowWorkspace.focusCanvas();
    else if (mode === "settings") {
      window.scrollTo({ top: 0, behavior: "instant" });
      settingsWorkspace.focusActive();
    }
    else {
      window.scrollTo({ top: operationsScroll, behavior: "instant" });
      if (lastOperationsFocus?.isConnected && lastOperationsFocus.getClientRects().length && !lastOperationsFocus.closest('[inert],[hidden]') && !lastOperationsFocus.matches(':disabled')) lastOperationsFocus.focus({ preventScroll: true });
      else operationsWorkspace.focusActive();
    }
  }

  async function setMode(next: WorkspaceMode) {
    if (next === mode) return;
    if (mode === "operations") {
      operationsWorkspace.cancelStepScroll();
      operationsScroll = window.scrollY;
    }
    mode = next;
    if (matchMedia("(max-width: 899px)").matches) navigationOpen = false;
    await focusDestination();
  }

  $effect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
  });

  function toggleTheme() {
    dark = !dark;
    try { localStorage.setItem("operations-theme", dark ? "dark" : "light"); }
    catch { /* Retain the selected theme for this session. */ }
  }

  $effect(() => {
    document.documentElement.dataset.palette = palette;
    try { localStorage.setItem("operations-palette", palette); }
    catch { /* Retain the selected palette for this session. */ }
  });

  function selectOperation(operation: Operation) {
    if (mode === "workflow") workflowWorkspace.addOperation(operation);
    else {
      mode = "operations";
      lastOperationsFocus = undefined;
      operationsWorkspace.selectOperation(operation);
    }
    if (window.matchMedia("(max-width: 899px)").matches) navigationOpen = false;
  }

  async function addToWorkflow(operation: Operation) {
    await setMode("workflow");
    await workflowWorkspace.addOperation(operation);
  }

  async function selectWorkflow(document: WorkflowDocument) {
    if (mode === "workflow") await workflowWorkspace.addWorkflow(document);
    else {
      await setMode("workflow");
      workflowWorkspace.startRun(document);
    }
  }

  /** Limit hover growth using layout dimensions unaffected by transforms. */
  function sizeHover(event: PointerEvent | FocusEvent) {
    if (!(event.target instanceof Element)) return;
    const surfaces = new Set<HTMLElement>();
    for (let element: Element | null = event.target; element; element = element.parentElement) {
      if (element instanceof HTMLElement && element.matches('button, summary, .result-card, .saved-documents li, .palette-choice'))
        surfaces.add(element);
    }
    // The operation description also animates its action button.
    const operation = event.target.closest('.catalog-operation');
    operation?.querySelectorAll<HTMLElement>('.catalog-open-operation').forEach(element => surfaces.add(element));

    const sizes = [...surfaces].map(element => ({ element, width: element.offsetWidth }));
    for (const { element, width } of sizes) {
      if (!width) continue;
      const scale = String(1 + 12 / width);
      if (element.style.getPropertyValue('--hover-scale') !== scale)
        element.style.setProperty('--hover-scale', scale);
    }
  }
</script>

<svelte:document onpointerover={sizeHover} onfocusin={sizeHover} />

<svelte:head>
  <title>operations.superduper.solutions</title>
  <meta name="description" content="Discover OpenAPI operations and compose reusable workflows in your browser." />
</svelte:head>

<Tooltip.Provider delayDuration={400} ignoreNonKeyboardFocus disableHoverableContent>
<BackgroundWave />
<NativeScrollbars />
<SideNavigation bind:this={sideNavigation} bind:open={navigationOpen} bind:modal={navigationModal} {documentModal} {operations} {mode} {dark}
  workflows={savedWorkflows} workflowError={workflowLibraryError} onWorkflowSelect={selectWorkflow} onWorkflowRetry={() => workflowWorkspace.refreshDocuments()}
  onSelect={selectOperation} onMode={setMode} onTheme={toggleTheme} />
<div class="page-content" class:catalog-open={navigationOpen} class:workflow-mode={mode === "workflow"}>
  <Header {navigationOpen} onMenu={() => navigationOpen = !navigationOpen} />
  <div class="shell">
    <main>
      <div bind:this={operationsHost} hidden={mode !== "operations"} onfocusin={(event) => { if (event.target instanceof HTMLElement) lastOperationsFocus = event.target; }}>
        <OperationsWorkspace bind:this={operationsWorkspace} {operations} active={mode === "operations"} onAddToWorkflow={addToWorkflow} onOperationSelect={(operation) => sideNavigation.revealOperation(operation)} />
      </div>
      <div class="workflow-host" hidden={mode !== "workflow"}>
        <WorkflowWorkspace bind:this={workflowWorkspace} bind:documentModal bind:documents={savedWorkflows} bind:libraryError={workflowLibraryError} active={mode === "workflow"} {navigationOpen} {navigationModal} onBrowse={() => navigationOpen = true} />
      </div>
      <div hidden={mode !== "settings"}>
        <SettingsWorkspace bind:this={settingsWorkspace} {palette} onPaletteChange={(next) => palette = next} />
      </div>
    </main>
  </div>
</div>
</Tooltip.Provider>
