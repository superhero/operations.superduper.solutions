<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { Tooltip } from "bits-ui";
  import type { Operation } from "$lib/catalog.ts";
  import { getSchemaLibrary } from "$lib/schema-library.ts";
  import type { WorkspaceMode, WorkflowSaveStatus } from "$lib/workspace.d.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import { loadSettings, saveSetting, type WorkflowDefaults } from "$lib/app-settings.ts";
  import { defaultLocaleSettings, normalizeLocaleSettings, type LocaleSettings } from "$lib/locale-settings.ts";
  import { defaultToolbarButtons, normalizeToolbarButtons, type ToolbarButtons } from "$lib/toolbar-settings.ts";
  import { defaultKeybindings, normalizeKeybindings, shortcutAction, type Keybindings } from "$lib/keybindings.ts";
  import { applyLocaleSettings } from "$lib/datetime-state.ts";
  import { logger } from "$lib/logger.ts";
  import Header from "./components/Header.svelte";
  import SideNavigation from "./components/SideNavigation.svelte";
  import WorkflowWorkspace from "./components/WorkflowWorkspace.svelte";
  import SettingsWorkspace, { palettes } from "./components/SettingsWorkspace.svelte";
  import BackgroundWave from "./components/BackgroundWave.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import NativeScrollbars from "./components/NativeScrollbars.svelte";

  let { initialSettingsPaneWidth = 900, initialToolbarButtons = defaultToolbarButtons, initialKeybindings = defaultKeybindings, initialWorkflowDefaults, initialDeveloperToolbar = false, initialEvaluationDetails = false, initialTooltips = true, initialLocale = defaultLocaleSettings, initialSettingsError = null }: {
    initialSettingsPaneWidth?: number;
    initialWorkflowDefaults: WorkflowDefaults;
    initialDeveloperToolbar?: boolean;
    initialEvaluationDetails?: boolean;
    initialTooltips?: boolean;
    initialLocale?: LocaleSettings;
    initialKeybindings?: Keybindings;
    initialToolbarButtons?: ToolbarButtons;
    initialSettingsError?: Error | null;
  } = $props();
  let workflowDefaults = $state<WorkflowDefaults>(untrack(() => ({ ...initialWorkflowDefaults })));
  let developerToolbar = $state(untrack(() => initialDeveloperToolbar));
  let developerToolbarError = $state("");
  let developerToolbarSave = 0;
  let tooltips = $state(untrack(() => initialTooltips));
  let tooltipsError = $state("");
  let tooltipsSave = 0;
  let evaluationDetails = $state(untrack(() => initialEvaluationDetails));
  let evaluationDetailsError = $state("");
  let evaluationDetailsSave = 0;
  let locale = $state<LocaleSettings>(untrack(() => normalizeLocaleSettings(initialLocale)));
  let keybindings = $state<Keybindings>(untrack(() => normalizeKeybindings(initialKeybindings)));
  let toolbarButtons = $state<ToolbarButtons>(untrack(() => normalizeToolbarButtons(initialToolbarButtons)));
  let toolbarButtonsError = $state("");
  let toolbarButtonsSave = 0;
  let keybindingsError = $state("");
  let keybindingsSave = 0;
  let localeError = $state("");
  let localeSave = 0;
  let settingsError = $state(untrack(() => initialSettingsError));
  let settingsRetrying = $state(false);
  const settingsEdits = { theme: 0, palette: 0, workflowDefaults: 0, developerToolbar: 0, evaluationDetails: 0, tooltips: 0, locale: 0, keybindings: 0, toolbarButtons: 0 };
  let workflowDefaultsError = $state("");
  let workflowDefaultsSave = 0;
  let navigationOpen = $state(!matchMedia("(max-width: 899px)").matches);
  let navigationModal = $state(false);
  let documentModal = $state(false);
  let workflowSaveStatus = $state<WorkflowSaveStatus>("loading");
  let savedWorkflows = $state<WorkflowDocument[]>([]);
  let workflowLibraryError = $state("");
  let mode = $state<WorkspaceMode>("workflow");
  let modeRequest = 0;
  let settingsPresent = $state(false);
  let viewportWidth = $state(window.innerWidth);
  let settingsPaneWidth = $state(untrack(() => initialSettingsPaneWidth));
  const compactSettings = $derived(viewportWidth < Math.max(900, settingsPaneWidth + 250));
  const concurrentPanes = $derived(!compactSettings && viewportWidth >= settingsPaneWidth + 320 + 500);
  let lastOpenedPane: "navigation" | "settings" = "navigation";
  let resizingSettings = $state<{ x: number; width: number } | null>(null);
  const maximumSettingsWidth = $derived(Math.max(360, Math.min(1440, viewportWidth - 250)));
  $effect(() => {
    document.documentElement.style.setProperty("--settings-drawer-width", `${compactSettings ? viewportWidth : settingsPaneWidth}px`);
    return () => document.documentElement.style.removeProperty("--settings-drawer-width");
  });
  $effect(() => {
    if (!concurrentPanes && navigationOpen && mode === "settings") {
      if (lastOpenedPane === "navigation") void setMode("workflow");
      else navigationOpen = false;
    }
  });
  $effect(() => {
    if (compactSettings && settingsPresent && document.activeElement?.closest(".workflow-host"))
      void tick().then(() => settingsWorkspace.focusActive());
  });
  function savePaneWidth() {
    void saveSetting("settingsPaneWidth", settingsPaneWidth).catch(reportSettingsError);
  }
  function resizeSettings(width: number) {
    lastOpenedPane = "settings";
    settingsPaneWidth = Math.round(Math.max(360, Math.min(maximumSettingsWidth, width)));
  }
  function startSettingsResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizingSettings = { x: event.clientX, width: settingsPaneWidth };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function finishSettingsResize() {
    if (!resizingSettings) return;
    resizingSettings = null;
    savePaneWidth();
  }
  function resizeSettingsKey(event: KeyboardEvent) {
    const delta = event.shiftKey ? 64 : 16;
    const width = event.key === "ArrowLeft" ? settingsPaneWidth + delta : event.key === "ArrowRight" ? settingsPaneWidth - delta
      : event.key === "Home" ? 360 : event.key === "End" ? maximumSettingsWidth : undefined;
    if (width === undefined) return;
    event.preventDefault(); event.stopPropagation();
    resizeSettings(width); savePaneWidth();
  }
  let settingsDrawer: HTMLElement;
  let settingsContent: HTMLElement;
  let settingsContentHeight = $state<number>();
  $effect(() => {
    if (!settingsPresent) return;
    const root = document.documentElement;
    const properties = ['overflow', 'scrollbar-gutter', 'padding-right'];
    const previous = properties.map(property => ({ property, value: root.style.getPropertyValue(property), priority: root.style.getPropertyPriority(property) }));
    const gutter = Math.max(0, window.innerWidth - root.getBoundingClientRect().width);
    const padding = parseFloat(getComputedStyle(root).paddingRight) || 0;
    // Replace the viewport scrollbar's gutter with padding so the canvas does not jump.
    root.style.setProperty('overflow', 'hidden');
    root.style.setProperty('scrollbar-gutter', 'auto');
    root.style.setProperty('padding-right', `${padding + gutter}px`);
    return () => {
      for (const { property, value, priority } of previous) {
        if (value) root.style.setProperty(property, value, priority);
        else root.style.removeProperty(property);
      }
    };
  });

  let dark = $state(document.documentElement.dataset.theme === "dark");
  let palette = $state(palettes.find(option => option.id === document.documentElement.dataset.palette)?.id ?? palettes[0].id);
  const operations = $derived(getSchemaLibrary().operations);
  const activeCatalogs = $derived(getSchemaLibrary().catalogs);
  const catalogGroups = $derived(activeCatalogs.flatMap(catalog => catalog.groups));
  let sideNavigation: SideNavigation;
  let workflowWorkspace: WorkflowWorkspace;
  let settingsWorkspace: SettingsWorkspace;

  async function focusDestination() {
    await tick();
    if (navigationModal) return;
    if (mode === "workflow") workflowWorkspace.focusCanvas();
    else settingsWorkspace.focusActive();
  }

  async function setMode(next: WorkspaceMode) {
    if (next === mode) return;
    const request = ++modeRequest;
    if (mode === "workflow" && !await workflowWorkspace.flushPendingChanges()) return;
    if (request !== modeRequest) return;
    // Lazy sections collapse while inactive. Retain their space and suspend
    // scroll anchoring until they reopen so neither can move the reading position.
    if (mode === "settings") settingsContentHeight = settingsContent.getBoundingClientRect().height;
    if (next === "settings") { settingsPresent = true; lastOpenedPane = "settings"; }
    mode = next;
    if ((next === "settings" && !concurrentPanes) || matchMedia("(max-width: 899px)").matches) navigationOpen = false;
    await tick();
    if (next === "workflow") {
      await Promise.all(settingsDrawer.getAnimations().map(animation => animation.finished.catch(() => {})));
      if (request !== modeRequest) return;
      settingsPresent = false;
      await tick();
    }
    await focusDestination();
    if (next === "settings") {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await Promise.allSettled(settingsDrawer.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished));
      if (request === modeRequest) settingsContentHeight = undefined;
    }
  }

  async function toggleSettings() {
    const closing = mode === "settings";
    await setMode(closing ? "workflow" : "settings");
    if (closing && mode === "workflow") document.querySelector<HTMLElement>('.site-header button[aria-pressed]')?.focus({ preventScroll: true });
  }

  async function toggleNavigation() {
    if (mode === "settings" && !concurrentPanes) {
      await setMode("workflow");
      navigationOpen = true;
    } else navigationOpen = !navigationOpen;
    if (navigationOpen) lastOpenedPane = "navigation";
  }

  function dismissMenus(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || !(navigationOpen || mode === "settings") ||
      shortcutAction(event, keybindings) !== "closeMenu" ||
      document.querySelector('[role="dialog"]:not(#side-navigation), [role="menu"], [role="listbox"]')) return;
    event.preventDefault();
    if (mode === "settings" && !(concurrentPanes && navigationOpen && document.activeElement?.closest("#side-navigation"))) void toggleSettings();
    else {
      navigationOpen = false;
      void tick().then(() => document.querySelector<HTMLElement>('[aria-controls="side-navigation"]')?.focus({ preventScroll: true }));
    }
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
    workflowWorkspace?.applyDisplayDefaults(next, workflowDefaults);
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

  function selectToolbarButtons(next: ToolbarButtons) {
    settingsEdits.toolbarButtons += 1;
    toolbarButtons = normalizeToolbarButtons(next);
    toolbarButtonsError = "";
    const request = ++toolbarButtonsSave;
    void saveSetting("toolbarButtons", toolbarButtons).catch(error => {
      if (request === toolbarButtonsSave) {
        toolbarButtonsError = "Could not save toolbar button preferences. These choices apply only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

  function selectKeybindings(next: Keybindings) {
    settingsEdits.keybindings += 1;
    keybindings = normalizeKeybindings(next);
    keybindingsError = "";
    const request = ++keybindingsSave;
    void saveSetting("keybindings", keybindings).catch(error => {
      if (request === keybindingsSave) {
        keybindingsError = "Could not save keybindings. These choices apply only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

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

  function selectEvaluationDetails(next: boolean) {
    settingsEdits.evaluationDetails += 1;
    evaluationDetails = next;
    evaluationDetailsError = "";
    const request = ++evaluationDetailsSave;
    void saveSetting("evaluationDetails", next).catch(error => {
      if (request === evaluationDetailsSave) {
        evaluationDetailsError = "Could not save this setting. It applies only to this session until saving succeeds.";
        void reportSettingsError(error);
      }
    });
  }

  function selectTooltips(next: boolean) {
    settingsEdits.tooltips += 1;
    tooltips = next;
    tooltipsError = "";
    const request = ++tooltipsSave;
    void saveSetting("tooltips", next).catch(error => {
      if (request === tooltipsSave) {
        tooltipsError = "Could not save this setting. It applies only to this session until saving succeeds.";
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
        if (edits.evaluationDetails === settingsEdits.evaluationDetails) evaluationDetails = settings.evaluationDetails;
        if (edits.tooltips === settingsEdits.tooltips) tooltips = settings.tooltips;
        if (edits.toolbarButtons === settingsEdits.toolbarButtons) toolbarButtons = settings.toolbarButtons;
        if (edits.keybindings === settingsEdits.keybindings) keybindings = settings.keybindings;
        if (edits.locale === settingsEdits.locale) locale = settings.locale;
      }
    } finally {
      settingsRetrying = false;
    }
  }

  async function browseOperations() {
    if (!concurrentPanes) {
      await setMode("workflow");
      if (mode !== "workflow") return;
    }
    navigationOpen = true;
    lastOpenedPane = "navigation";
    await tick();
    await sideNavigation.focusPrompt();
  }
  async function selectOperation(operation: Operation) {
    if (!concurrentPanes) await setMode("workflow");
    await workflowWorkspace.addOperation(operation);
    if (matchMedia("(max-width: 899px)").matches) navigationOpen = false;
  }

  async function selectWorkflow(document: WorkflowDocument) {
    if (!concurrentPanes) await setMode("workflow");
    await workflowWorkspace.addWorkflow(document);
    if (matchMedia("(max-width: 899px)").matches) navigationOpen = false;
  }

  /** Limit hover growth using layout dimensions unaffected by transforms. */
  function sizeHover(event: PointerEvent | FocusEvent) {
    if (!(event.target instanceof Element)) return;
    const surfaces = new Set<HTMLElement>();
    for (let element: Element | null = event.target; element; element = element.parentElement) {
      if (element instanceof HTMLElement && element.matches('button, summary, .saved-documents li, .palette-choice'))
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
<svelte:window bind:innerWidth={viewportWidth} onkeydown={dismissMenus} />

<svelte:head>
  <title>operations.superduper.solutions</title>
  <meta name="description" content="Discover OpenAPI operations and compose reusable workflows in your browser." />
</svelte:head>

<Tooltip.Provider disabled={!tooltips} delayDuration={400} ignoreNonKeyboardFocus disableHoverableContent>
<BackgroundWave />
<NativeScrollbars />
<SideNavigation closeMenuWithEscape={keybindings.closeMenu === "Escape"} bind:this={sideNavigation} bind:open={navigationOpen} bind:modal={navigationModal} {documentModal} {operations} {evaluationDetails} {catalogGroups}
  workflows={savedWorkflows} workflowError={workflowLibraryError} onWorkflowSelect={selectWorkflow} onWorkflowRetry={() => workflowWorkspace.refreshDocuments()}
  onSelect={selectOperation} />
<div class="page-content workflow-mode" class:compact-settings={compactSettings} class:resizing-settings={resizingSettings !== null} inert={settingsPresent && compactSettings} class:catalog-open={navigationOpen} class:settings-open={mode === "settings"}>
  <Header {navigationOpen} settingsOpen={mode === "settings"} onSettings={toggleSettings} {workflowSaveStatus} onMenu={toggleNavigation} />
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
      <div class="workflow-host">
        <WorkflowWorkspace bind:this={workflowWorkspace} bind:documentModal bind:saveStatus={workflowSaveStatus} bind:documents={savedWorkflows} bind:libraryError={workflowLibraryError} active={!(settingsPresent && compactSettings)} settingsOpen={mode === "settings"} {navigationOpen} {navigationModal} {workflowDefaults} {keybindings} {toolbarButtons} onBrowse={browseOperations} />
      </div>
    </main>
  </div>
</div>
{#if compactSettings && settingsPresent}
  <div class="settings-backdrop" class:open={mode === "settings"} aria-hidden="true"></div>
{/if}
<div class="settings-drawer-host" class:compact={compactSettings} class:resizing={resizingSettings !== null}>
  {#if mode === "settings" && !compactSettings}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable ARIA window splitter with arrow-key resizing.) -->
    <div class="settings-resize" role="separator" tabindex="0" aria-label="Settings pane width" aria-orientation="vertical"
      aria-valuemin={360} aria-valuemax={maximumSettingsWidth} aria-valuenow={settingsPaneWidth} aria-valuetext={`${settingsPaneWidth} pixels`}
      onpointerdown={startSettingsResize}
      onpointermove={event => { if (resizingSettings) resizeSettings(resizingSettings.width + resizingSettings.x - event.clientX); }}
      onpointerup={finishSettingsResize} onpointercancel={finishSettingsResize} onlostpointercapture={finishSettingsResize}
      onkeydown={resizeSettingsKey} ondblclick={() => { resizeSettings(900); savePaneWidth(); }}></div>
  {/if}
  <aside id="settings-panel" bind:this={settingsDrawer} class="settings-drawer" class:open={mode === "settings"} class:preserving-scroll={settingsContentHeight !== undefined} aria-label="Application settings" inert={mode !== "settings"}>
    {#if compactSettings}
      <div class="settings-mobile-header">
        <HintButton tooltipSide="left" label="Close settings" aria-label="Close settings" onclick={toggleSettings}>
          <MaterialIcon name="close" size={24} />
        </HintButton>
      </div>
    {/if}
    <div bind:this={settingsContent} style:min-height={settingsContentHeight === undefined ? undefined : `${settingsContentHeight}px`}>
      <SettingsWorkspace active={settingsPresent} bind:this={settingsWorkspace} {dark} onTheme={toggleTheme} {tooltips} {tooltipsError} onTooltipsChange={selectTooltips} {palette} onPaletteChange={selectPalette} {workflowDefaults} {workflowDefaultsError}
          {toolbarButtons} {toolbarButtonsError} onToolbarButtonsChange={selectToolbarButtons} onRetryToolbarButtons={() => selectToolbarButtons(toolbarButtons)}
          {keybindings} {keybindingsError} onKeybindingsChange={selectKeybindings} onRetryKeybindings={() => selectKeybindings(keybindings)}
          {locale} {localeError} onLocaleChange={selectLocale} onRetryLocale={() => selectLocale(locale)}
          settingsUnavailable={Boolean(settingsError)} {settingsRetrying} onRetrySettings={retrySettings}
          {developerToolbar} {developerToolbarError} onDeveloperToolbarChange={selectDeveloperToolbar}
          {evaluationDetails} {evaluationDetailsError} onEvaluationDetailsChange={selectEvaluationDetails}
          onWorkflowDefaultsChange={selectWorkflowDefaults} onRetryWorkflowDefaults={() => selectWorkflowDefaults(workflowDefaults)} />
    </div>
  </aside>
</div>
</Tooltip.Provider>

<style>
  .page-content { --workflow-controls-inset: 0px; --navigation-inset: 0px; }
  @media (min-width: 900px) { .page-content.catalog-open { --navigation-inset: var(--catalog-width); } }
  .page-content.settings-open:not(.compact-settings) { --workflow-controls-inset: var(--settings-drawer-width); }
  .page-content :global(.workflow-toolbar), .page-content :global(.workflow-minimap) { right: var(--workflow-controls-inset); max-width: calc(100% - var(--workflow-controls-inset) - 2rem); transition: right 200ms ease-in-out, max-width 200ms ease-in-out; }
  .page-content :global(.workflow-toolbar) { max-width: calc(100% - var(--workflow-controls-inset) - var(--navigation-inset) - 2rem); }
  /* The fixed settings drawer spans the viewport, including its reserved scrollbar gutter. */
  .page-content :global(.workflow-empty) { left: var(--navigation-inset); right: max(0px, calc(var(--workflow-controls-inset) + 100% - 100vw)); transition: left 200ms ease-in-out, right 200ms ease-in-out; }
  .page-content :global(.workflow-control-group) { max-width: 100%; flex-wrap: wrap; }
  .page-content :global(.workflow-minimap .svelte-flow__minimap-svg) { max-width: 100%; height: auto; }
  .page-content :global(.site-header) { margin-left: var(--navigation-inset); width: calc(100% - var(--workflow-controls-inset) - var(--navigation-inset)); transition: width 200ms ease-in-out, margin-left 200ms ease-in-out; }
  .page-content.resizing-settings :global(.site-header), .page-content.resizing-settings :global(.workflow-toolbar), .page-content.resizing-settings :global(.workflow-minimap), .page-content.resizing-settings :global(.workflow-empty) { transition: none; }
  .settings-backdrop { position: fixed; inset: 0; z-index: 24; background: color-mix(in srgb, var(--color-background) 65%, transparent); opacity: 0; transition: opacity 200ms ease-in-out; }
  .settings-backdrop.open { opacity: 1; }
  .settings-drawer-host { position: fixed; z-index: 25; top: 0; right: 0; bottom: 0; width: var(--settings-drawer-width); overflow: clip; pointer-events: none; }
  .settings-drawer { --app-header-height: 0px; height: 100%; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; pointer-events: auto; background: var(--color-surface); border-left: 1px solid var(--color-border); transform: translateX(100%); visibility: hidden; transition: transform 200ms ease-in-out, visibility 0s linear 200ms; }
  .settings-drawer.preserving-scroll { overflow-anchor: none; }
  .settings-mobile-header { position: sticky; top: 0; z-index: 20; display: flex; justify-content: flex-end; align-items: center; height: 64px; padding-inline: var(--content-padding); background: var(--color-surface); }
  .settings-mobile-header :global(button) { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; background: transparent; color: var(--color-foreground); }
  .settings-drawer-host.compact .settings-drawer { --app-header-height: 64px; }
  .settings-drawer-host.compact .settings-drawer :global(.workspace) { padding-top: 0; }
  .settings-resize { position: absolute; z-index: 30; left: 0; top: 0; bottom: 0; width: 10px; cursor: ew-resize; touch-action: none; pointer-events: auto; }
  .settings-resize::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: transparent; }
  .settings-resize:hover::after, .settings-resize:focus-visible::after, .resizing .settings-resize::after { background: var(--color-emphasis); }
  .settings-resize:focus-visible { outline: 2px solid var(--color-emphasis); outline-offset: -2px; }
  .resizing { user-select: none; }
  .settings-drawer.open { transform: translateX(0); visibility: visible; transition-delay: 0s; }
  @media (prefers-reduced-motion: reduce) { .settings-backdrop, .settings-drawer, .page-content :global(.site-header), .page-content :global(.workflow-toolbar), .page-content :global(.workflow-minimap), .page-content :global(.workflow-empty) { transition: none; } }

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
