<script lang="ts">
  import { tick, untrack } from "svelte";
  import { Tooltip } from "bits-ui";
  import type { Operation } from "$lib/catalog.ts";
  import { getSchemaLibrary } from "$lib/schema-library.ts";
  import type { WorkspaceMode, WorkflowSaveStatus } from "$lib/workspace.d.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import { loadSettings, saveSetting, type WorkflowDefaults } from "$lib/app-settings.ts";
  import { defaultLocaleSettings, normalizeLocaleSettings, type LocaleSettings } from "$lib/locale-settings.ts";
  import { applyLocaleSettings } from "$lib/datetime-state.ts";
  import { logger } from "$lib/logger.ts";
  import Header from "./components/Header.svelte";
  import SideNavigation from "./components/SideNavigation.svelte";
  import OperationsWorkspace from "./components/OperationsWorkspace.svelte";
  import WorkflowWorkspace from "./components/WorkflowWorkspace.svelte";
  import SettingsWorkspace, { palettes } from "./components/SettingsWorkspace.svelte";
  import BackgroundWave from "./components/BackgroundWave.svelte";
  import NativeScrollbars from "./components/NativeScrollbars.svelte";

  let { initialWorkflowDefaults, initialDeveloperToolbar = false, initialLocale = defaultLocaleSettings, initialSettingsError = null }: {
    initialWorkflowDefaults: WorkflowDefaults;
    initialDeveloperToolbar?: boolean;
    initialLocale?: LocaleSettings;
    initialSettingsError?: Error | null;
  } = $props();
  let workflowDefaults = $state<WorkflowDefaults>(untrack(() => ({ ...initialWorkflowDefaults })));
  let developerToolbar = $state(untrack(() => initialDeveloperToolbar));
  let developerToolbarError = $state("");
  let developerToolbarSave = 0;
  let locale = $state<LocaleSettings>(untrack(() => normalizeLocaleSettings(initialLocale)));
  let localeError = $state("");
  let localeSave = 0;
  let settingsError = $state(untrack(() => initialSettingsError));
  let settingsRetrying = $state(false);
  const settingsEdits = { theme: 0, palette: 0, workflowDefaults: 0, developerToolbar: 0, locale: 0 };
  let workflowDefaultsError = $state("");
  let workflowDefaultsSave = 0;
  let navigationOpen = $state(false);
  let navigationModal = $state(false);
  let documentModal = $state(false);
  let workflowSaveStatus = $state<WorkflowSaveStatus>("loading");
  let savedWorkflows = $state<WorkflowDocument[]>([]);
  let workflowLibraryError = $state("");
  let mode = $state<WorkspaceMode>("operations");
  let modeRequest = 0;
  let dark = $state(document.documentElement.dataset.theme === "dark");
  let palette = $state(palettes.find(option => option.id === document.documentElement.dataset.palette)?.id ?? palettes[0].id);
  let operationsWorkspace: OperationsWorkspace;
  const operations = $derived(getSchemaLibrary().operations);
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
    const request = ++modeRequest;
    if (next === mode) return;
    if (mode === "workflow" && !await workflowWorkspace.flushPendingChanges()) return;
    if (request !== modeRequest) return;
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
    settingsEdits.theme += 1;
    dark = !dark;
    void saveSetting("theme", dark ? "dark" : "light").catch(reportSettingsError);
  }

  $effect(() => {
    document.documentElement.dataset.palette = palette;
  });

  function selectPalette(next: typeof palette) {
    settingsEdits.palette += 1;
    palette = next;
    void saveSetting("palette", palette).catch(reportSettingsError);
  }

  function selectWorkflowDefaults(next: WorkflowDefaults) {
    settingsEdits.workflowDefaults += 1;
    workflowDefaults = { ...next };
    workflowDefaultsError = "";
    const request = ++workflowDefaultsSave;
    void saveSetting("workflowDefaults", next).catch(error => {
      if (request === workflowDefaultsSave) {
        workflowDefaultsError = "Could not save workflow defaults. These choices apply only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

  $effect(() => { applyLocaleSettings(locale); });

  function selectLocale(next: LocaleSettings) {
    settingsEdits.locale += 1;
    locale = normalizeLocaleSettings(next);
    localeError = "";
    const request = ++localeSave;
    void saveSetting("locale", locale).catch(error => {
      if (request === localeSave) {
        localeError = "Could not save locale preferences. These choices apply only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

  $effect(() => {
    if (!import.meta.env.DEV) return;
    document.documentElement.dataset.developerToolbar = String(developerToolbar);
    for (const toolbar of document.querySelectorAll<HTMLElement>("dev-toolbar"))
      toolbar.inert = !developerToolbar;
    if (developerToolbar) {
      const frame = requestAnimationFrame(() => {
        for (const toolbar of document.querySelectorAll<HTMLElement & { setToolbarVisible?: (visible: boolean) => void }>("dev-toolbar")) {
          toolbar.setToolbarVisible?.(true);
          // Wake the toolbar from its inactivity-minimized state when opting in.
          toolbar.shadowRoot?.querySelector("#__v_dt__root")?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    // Reset panels opened before opting out or by a shortcut while hidden.
    for (const toolbar of document.querySelectorAll("dev-toolbar"))
      toolbar.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close DevTools panel"]')?.click();
  });

  function selectDeveloperToolbar(next: boolean) {
    settingsEdits.developerToolbar += 1;
    developerToolbar = next;
    developerToolbarError = "";
    const request = ++developerToolbarSave;
    void saveSetting("developerToolbar", next).catch(error => {
      if (request === developerToolbarSave) {
        developerToolbarError = "Could not save this setting. It applies only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

  async function reportSettingsError(error: unknown) {
    const failure = error instanceof Error ? error : new Error("Could not access saved settings.", { cause: error });
    // Keep the recovered app usable behind the overlay, with its palette applied.
    await tick();
    logger.error(failure);
  }

  async function retrySettings() {
    if (settingsRetrying) return;
    settingsRetrying = true;
    const edits = { ...settingsEdits };
    try {
      const settings = await loadSettings(palettes.map(option => option.id));
      settingsError = settings.storageError;
      if (settingsError) await reportSettingsError(settingsError);
      else {
        // A retry must not replace a choice made while the read was pending.
        if (edits.theme === settingsEdits.theme) dark = settings.theme === "dark";
        if (edits.palette === settingsEdits.palette) palette = palettes.find(option => option.id === settings.palette)?.id ?? palettes[0].id;
        if (edits.workflowDefaults === settingsEdits.workflowDefaults) workflowDefaults = settings.workflowDefaults;
        if (edits.developerToolbar === settingsEdits.developerToolbar) developerToolbar = settings.developerToolbar;
        if (edits.locale === settingsEdits.locale) locale = settings.locale;
      }
    } finally {
      settingsRetrying = false;
    }
  }

  function selectOperation(operation: Operation) {
    modeRequest += 1;
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
  <Header {navigationOpen} workflowSaveStatus={mode === "workflow" ? workflowSaveStatus : undefined} onMenu={() => navigationOpen = !navigationOpen} />
  <div class="shell">
    <main>
      {#if settingsError && !import.meta.env.DEV}
        <div class="settings-recovery" role="alert">
          <div class="settings-recovery-message">
            <h2>Saved settings are unavailable</h2>
            <p>{settingsError.message}</p>
            <p>Current choices remain available for this session.</p>
          </div>
        </div>
      {/if}
      <div bind:this={operationsHost} hidden={mode !== "operations"} onfocusin={(event) => { if (event.target instanceof HTMLElement) lastOperationsFocus = event.target; }}>
        <OperationsWorkspace bind:this={operationsWorkspace} {operations} active={mode === "operations"} onAddToWorkflow={addToWorkflow} onOperationSelect={(operation) => sideNavigation.revealOperation(operation)} />
      </div>
      <div class="workflow-host" hidden={mode !== "workflow"}>
        <WorkflowWorkspace bind:this={workflowWorkspace} bind:documentModal bind:saveStatus={workflowSaveStatus} bind:documents={savedWorkflows} bind:libraryError={workflowLibraryError} active={mode === "workflow"} {navigationOpen} {navigationModal} {workflowDefaults} onBrowse={() => navigationOpen = !navigationOpen} />
      </div>
      <div hidden={mode !== "settings"}>
        <SettingsWorkspace bind:this={settingsWorkspace} {palette} onPaletteChange={selectPalette} {workflowDefaults} {workflowDefaultsError}
          {locale} {localeError} onLocaleChange={selectLocale} onRetryLocale={() => selectLocale(locale)}
          settingsUnavailable={Boolean(settingsError)} {settingsRetrying} onRetrySettings={retrySettings}
          {developerToolbar} {developerToolbarError} onDeveloperToolbarChange={selectDeveloperToolbar}
          onWorkflowDefaultsChange={selectWorkflowDefaults} onRetryWorkflowDefaults={() => selectWorkflowDefaults(workflowDefaults)} />
      </div>
    </main>
  </div>
</div>
</Tooltip.Provider>

<style>
  .settings-recovery {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
    padding: 16px;
    border-radius: 4px;
    color: var(--color-foreground);
    background: var(--color-surface);
  }
  .settings-recovery-message { flex: 1; min-width: min(100%, 260px); }
  .settings-recovery h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 700; }
  .settings-recovery p { margin: 0 0 8px; white-space: pre-line; overflow-wrap: anywhere; }
</style>
