<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script module lang="ts">
  export const palettes = [
    { id: "default", name: "Default" },
    { id: "graphite-study", name: "Graphite" },
    { id: "steel-and-mist", name: "Steel" },
    { id: "alpine", name: "Alpine" },
    { id: "sunflower", name: "Cappuccino" },
    { id: "bonfire", name: "Bonfire" },
    { id: "obsidian", name: "Obsidian" },
    { id: "heritage-noir", name: "Heritage Noir" },
    { id: "carbon", name: "Carbon" },
    { id: "midnight-gold", name: "Midnight Gold" },
    { id: "harvest-moon", name: "Harvest Moon" },
    { id: "neon", name: "Neon" },
    { id: "rainfall", name: "Rainfall" },
    { id: "autumn", name: "Autumn" },
    { id: "sunset", name: "Sunset" },
    { id: "golden-violet", name: "Golden Violet" },
    { id: "garden-dusk", name: "Garden Dusk" },
    { id: "blue-horizon", name: "Blue Horizon" },
    { id: "spring", name: "Spring" },
    { id: "lantern", name: "Lantern" },
    { id: "citrus", name: "Citrus" },
  ] as const;
  export type PaletteId = (typeof palettes)[number]["id"];
</script>

<script lang="ts">
  import Disclosure from "$lib/components/Disclosure.svelte";
  import FieldInteger from "$lib/components/FieldInteger.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import StorageSettings from "./settings/StorageSettings.svelte";
  import LocaleSettings from "./settings/LocaleSettings.svelte";
  import SchemaSettings from "./settings/SchemaSettings.svelte";
  import { getSchemaLibrary, loadSchemaLibrary, uploadSchema, replaceSchema, renameSchema, moveSchema, setSchemaEnabled, deleteSchema, downloadSchema } from "$lib/schema-library.ts";
  import { defaultLocaleSettings, type LocaleSettings as LocalePreferences } from "$lib/locale-settings.ts";
  import { isValidWorkflowCurveStrength, isValidWorkflowDashLength, isValidWorkflowDashGap, isValidWorkflowDashSpeed, isValidWorkflowGridSize, isValidWorkflowNodeClearance,
    workflowCurveStrengthLimits, workflowDashLengthLimits, workflowDashGapLimits, workflowDashSpeedLimits, workflowGridSizeLimits, workflowNodeClearanceLimits, type WorkflowDefaults } from "$lib/app-settings.ts";

  let { palette, onPaletteChange, workflowDefaults, onWorkflowDefaultsChange, workflowDefaultsError = "", onRetryWorkflowDefaults,
    locale = defaultLocaleSettings, localeError = "", onLocaleChange = () => {}, onRetryLocale = () => {},
    developerToolbar, developerToolbarError = "", onDeveloperToolbarChange,
    customCursors = true, customCursorsError = "", onCustomCursorsChange,
    settingsUnavailable, settingsRetrying, onRetrySettings }: {
    palette: PaletteId;
    onPaletteChange: (palette: PaletteId) => void;
    workflowDefaults: WorkflowDefaults;
    onWorkflowDefaultsChange: (next: WorkflowDefaults) => void;
    workflowDefaultsError?: string;
    onRetryWorkflowDefaults: () => void;
    locale?: LocalePreferences;
    localeError?: string;
    onLocaleChange?: (next: LocalePreferences) => void;
    onRetryLocale?: () => void;
    developerToolbar: boolean;
    developerToolbarError?: string;
    onDeveloperToolbarChange: (enabled: boolean) => void;
    customCursors?: boolean;
    customCursorsError?: string;
    onCustomCursorsChange: (enabled: boolean) => void;
    settingsUnavailable: boolean;
    settingsRetrying: boolean;
    onRetrySettings: () => void;
  } = $props();
  let workspace: HTMLElement;
  let openSection = $state<"theme" | "locale" | "schemas" | "workflow" | "storage" | "developer" | null>(null);
  const schemaLibrary = $derived(getSchemaLibrary());
  let gridSizeDraft = $state("");
  let gridSizeInvalid = $state(false);
  const savedGridSize = $derived(workflowDefaults.gridSize);
  let dashLengthDraft = $state("");
  let dashLengthInvalid = $state(false);
  const savedDashLength = $derived(workflowDefaults.dashLength);
  let dashGapDraft = $state("");
  let dashGapInvalid = $state(false);
  const savedDashGap = $derived(workflowDefaults.dashGap);
  let dashSpeedDraft = $state("");
  let dashSpeedInvalid = $state(false);
  const savedDashSpeed = $derived(workflowDefaults.dashSpeed);
  let curveStrengthDraft = $state("");
  let curveStrengthInvalid = $state(false);
  const savedCurveStrength = $derived(workflowDefaults.curveStrength);
  let nodeClearanceDraft = $state("");
  let nodeClearanceInvalid = $state(false);
  const savedNodeClearance = $derived(workflowDefaults.nodeClearance);
  const workflowOptions: { key: "dashed" | "curved" | "snap"; label: string }[] = [
    { key: "dashed", label: "Dashed lines" },
    { key: "curved", label: "Curved lines" },
    { key: "snap", label: "Snap to grid" }
  ];

  $effect(() => { gridSizeDraft = String(savedGridSize); gridSizeInvalid = false; });
  $effect(() => { dashLengthDraft = String(savedDashLength); dashLengthInvalid = false; });
  $effect(() => { dashGapDraft = String(savedDashGap); dashGapInvalid = false; });
  $effect(() => { dashSpeedDraft = String(savedDashSpeed); dashSpeedInvalid = false; });
  $effect(() => { curveStrengthDraft = String(savedCurveStrength); curveStrengthInvalid = false; });
  $effect(() => { nodeClearanceDraft = String(savedNodeClearance); nodeClearanceInvalid = false; });

  function commitGridSize() {
    const raw = gridSizeDraft.trim();
    const gridSize = Number(raw);
    gridSizeInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowGridSize(gridSize);
    if (gridSizeInvalid) return;
    if (gridSize !== workflowDefaults.gridSize) onWorkflowDefaultsChange({ ...workflowDefaults, gridSize });
  }

  function commitDashLength() {
    const raw = dashLengthDraft.trim();
    const dashLength = Number(raw);
    dashLengthInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowDashLength(dashLength);
    if (dashLengthInvalid) return;
    if (dashLength !== workflowDefaults.dashLength) onWorkflowDefaultsChange({ ...workflowDefaults, dashLength });
  }

  function commitDashGap() {
    const raw = dashGapDraft.trim();
    const dashGap = Number(raw);
    dashGapInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowDashGap(dashGap);
    if (dashGapInvalid) return;
    if (dashGap !== workflowDefaults.dashGap) onWorkflowDefaultsChange({ ...workflowDefaults, dashGap });
  }

  function commitDashSpeed() {
    const raw = dashSpeedDraft.trim();
    const dashSpeed = Number(raw);
    dashSpeedInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowDashSpeed(dashSpeed);
    if (dashSpeedInvalid) return;
    if (dashSpeed !== workflowDefaults.dashSpeed) onWorkflowDefaultsChange({ ...workflowDefaults, dashSpeed });
  }

  function commitCurveStrength() {
    const raw = curveStrengthDraft.trim();
    const curveStrength = Number(raw);
    curveStrengthInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowCurveStrength(curveStrength);
    if (curveStrengthInvalid) return;
    if (curveStrength !== workflowDefaults.curveStrength) onWorkflowDefaultsChange({ ...workflowDefaults, curveStrength });
  }

  function commitNodeClearance() {
    const raw = nodeClearanceDraft.trim();
    const nodeClearance = Number(raw);
    nodeClearanceInvalid = !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !isValidWorkflowNodeClearance(nodeClearance);
    if (nodeClearanceInvalid) return;
    if (nodeClearance !== workflowDefaults.nodeClearance) onWorkflowDefaultsChange({ ...workflowDefaults, nodeClearance });
  }

  export function focusActive() {
    workspace.focus({ preventScroll: true });
  }
</script>

<section class="workspace" aria-label="Settings workspace" bind:this={workspace} tabindex="-1">
  <div class="settings-sections">
    <Disclosure class="catalog-group settings-section" label="Browser" tooltipEnabled={false} lazy animateSize open={openSection === "storage"} onToggle={(next) => openSection = next ? "storage" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Browser</h2><span class="section-subtitle">Monitor browser resource usage</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      {#if settingsUnavailable}
        <div class="settings-retry">
          <button class="defaults-retry" type="button" disabled={settingsRetrying} onclick={onRetrySettings}>
            {settingsRetrying ? "Retrying saved settings…" : "Retry saved settings"}
          </button>
        </div>
      {/if}
      <StorageSettings />
    </Disclosure>
    {#if import.meta.env.DEV}
      <Disclosure class="catalog-group settings-section" label="Developer" tooltipEnabled={false} open={openSection === "developer"} onToggle={(next) => openSection = next ? "developer" : null}>
        {#snippet summary()}
          <div class="section-heading"><h2>Developer</h2><span class="section-subtitle">Choose whether to show the developer toolbar</span></div>
          <MaterialIcon name="chevron_forward" size={17} />
        {/snippet}
        <fieldset class="workflow-settings" aria-label="Developer">
          <div class="workflow-defaults">
            <div class="workflow-default-pair">
              <button class="workflow-default" type="button" role="switch" aria-checked={developerToolbar}
                onclick={() => onDeveloperToolbarChange(!developerToolbar)}>
                <span>Developer toolbar</span><span class="default-switch" aria-hidden="true"><span></span></span>
              </button>
            </div>
          </div>
          {#if developerToolbarError}
            <div class="defaults-error"><p role="alert">{developerToolbarError}</p><button class="defaults-retry" type="button" onclick={() => onDeveloperToolbarChange(developerToolbar)}>Retry saving</button></div>
          {/if}
        </fieldset>
      </Disclosure>
    {/if}
    <Disclosure class="catalog-group settings-section" label="Locale" tooltipEnabled={false} open={openSection === "locale"} onToggle={(next) => openSection = next ? "locale" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Locale</h2><span class="section-subtitle">Choose date, time and timezone preferences</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <LocaleSettings value={locale} onValueChange={onLocaleChange} error={localeError} onRetry={onRetryLocale} />
    </Disclosure>
    <Disclosure class="catalog-group settings-section" label="Schemas" tooltipEnabled={false} open={openSection === "schemas"} onToggle={(next) => openSection = next ? "schemas" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Schemas</h2><span class="section-subtitle">Manage your OpenAPI documents</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <SchemaSettings records={schemaLibrary.records} busy={schemaLibrary.busy} ready={schemaLibrary.initialized} error={schemaLibrary.error}
        onUpload={uploadSchema} onReplace={replaceSchema} onRename={renameSchema} onMove={moveSchema} onEnabledChange={setSchemaEnabled} onDelete={deleteSchema}
        onDownload={downloadSchema} onRetry={loadSchemaLibrary} />
    </Disclosure>
    <Disclosure class="catalog-group settings-section" label="Theme" tooltipEnabled={false} open={openSection === "theme"} onToggle={(next) => openSection = next ? "theme" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Theme</h2><span class="section-subtitle">Decide what color the webpage will use</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <fieldset class="workflow-settings" aria-label="Cursor appearance">
        <div class="workflow-defaults">
          <div class="workflow-default-pair">
            <button class="workflow-default" type="button" role="switch" aria-checked={customCursors}
              onclick={() => onCustomCursorsChange(!customCursors)}>
              <span>Custom cursors</span><span class="default-switch" aria-hidden="true"><span></span></span>
            </button>
          </div>
        </div>
        {#if customCursorsError}
          <div class="defaults-error"><p role="alert">{customCursorsError}</p><button class="defaults-retry" type="button" onclick={() => onCustomCursorsChange(customCursors)}>Retry saving</button></div>
        {/if}
      </fieldset>
      <fieldset aria-label="Color palette">
        <div class="palette-options">
          {#each palettes as option (option.id)}
            <label class="palette-choice">
              <input type="radio" name="color-palette" value={option.id} aria-label={option.name}
                checked={palette === option.id} onchange={() => onPaletteChange(option.id)} />
              <span class="palette-card">
                <span class="palette-swatches" data-palette-preview={option.id} aria-hidden="true">
                  {#each [1, 2, 3, 4, 5, 6] as slot (slot)}<span style:background-color={`var(--palette-${slot})`}></span>{/each}
                  <MaterialIcon name="award_star" class="palette-selected-icon" size={64} />
                </span>
                <span class="palette-heading"><strong>{option.name}</strong></span>
              </span>
            </label>
          {/each}
        </div>
      </fieldset>
    </Disclosure>
    <Disclosure class="catalog-group settings-section" label="Workflows" tooltipEnabled={false} open={openSection === "workflow"} onToggle={(next) => openSection = next ? "workflow" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Workflows</h2><span class="section-subtitle">Configure workflow defaults</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <fieldset class="workflow-settings" aria-label="Workflow defaults">
        <div class="workflow-defaults">
          {#each workflowOptions as option (option.key)}
            <div class="workflow-default-pair">
              <button class="workflow-default" type="button" role="switch" aria-checked={workflowDefaults[option.key]}
                onclick={() => onWorkflowDefaultsChange({ ...workflowDefaults, [option.key]: !workflowDefaults[option.key] })}>
                <span>{option.label}</span><span class="default-switch" aria-hidden="true"><span></span></span>
              </button>
              {#if option.key === "snap"}
                <div class="grid-size-setting">
                  <span>Grid size</span>
                  <div class="grid-size-control">
                    <FieldInteger id="workflow-grid-size" label="Grid size" value={gridSizeDraft}
                      minimum={workflowGridSizeLimits.min} maximum={workflowGridSizeLimits.max} required invalid={gridSizeInvalid}
                      describedBy={gridSizeInvalid ? "workflow-grid-size-error" : undefined}
                      onValueChange={value => { gridSizeDraft = value; gridSizeInvalid = false; }} onValueCommit={commitGridSize} />
                    <span aria-hidden="true">px</span>
                  </div>
                  {#if gridSizeInvalid}<span class="grid-size-error" id="workflow-grid-size-error" role="alert">Grid size must be a whole number from {workflowGridSizeLimits.min} to {workflowGridSizeLimits.max}.</span>{/if}
                </div>
              {:else if option.key === "dashed"}
                <div class="grid-size-setting">
                  <span>Dash length</span>
                  <div class="grid-size-control">
                    <FieldInteger id="workflow-dash-length" label="Dash length" value={dashLengthDraft}
                      minimum={workflowDashLengthLimits.min} maximum={workflowDashLengthLimits.max} required invalid={dashLengthInvalid}
                      describedBy={dashLengthInvalid ? "workflow-dash-length-error" : undefined}
                      onValueChange={value => { dashLengthDraft = value; dashLengthInvalid = false; }} onValueCommit={commitDashLength} />
                    <span aria-hidden="true">px</span>
                  </div>
                  {#if dashLengthInvalid}<span class="grid-size-error" id="workflow-dash-length-error" role="alert">Dash length must be a whole number from {workflowDashLengthLimits.min} to {workflowDashLengthLimits.max}.</span>{/if}
                </div>
                <div class="grid-size-setting">
                  <span>Dash gap</span>
                  <div class="grid-size-control">
                    <FieldInteger id="workflow-dash-gap" label="Dash gap" value={dashGapDraft}
                      minimum={workflowDashGapLimits.min} maximum={workflowDashGapLimits.max} required invalid={dashGapInvalid}
                      describedBy={dashGapInvalid ? "workflow-dash-gap-error" : undefined}
                      onValueChange={value => { dashGapDraft = value; dashGapInvalid = false; }} onValueCommit={commitDashGap} />
                    <span aria-hidden="true">px</span>
                  </div>
                  {#if dashGapInvalid}<span class="grid-size-error" id="workflow-dash-gap-error" role="alert">Dash gap must be a whole number from {workflowDashGapLimits.min} to {workflowDashGapLimits.max}.</span>{/if}
                </div>
                <div class="grid-size-setting">
                  <span>Dash speed</span>
                  <div class="grid-size-control">
                    <FieldInteger id="workflow-dash-speed" label="Dash speed" value={dashSpeedDraft}
                      minimum={workflowDashSpeedLimits.min} maximum={workflowDashSpeedLimits.max} required invalid={dashSpeedInvalid}
                      describedBy={dashSpeedInvalid ? "workflow-dash-speed-error" : undefined}
                      onValueChange={value => { dashSpeedDraft = value; dashSpeedInvalid = false; }} onValueCommit={commitDashSpeed} />
                    <span aria-hidden="true">px/s</span>
                  </div>
                  {#if dashSpeedInvalid}<span class="grid-size-error" id="workflow-dash-speed-error" role="alert">Dash speed must be a whole number from {workflowDashSpeedLimits.min} to {workflowDashSpeedLimits.max}.</span>{/if}
                </div>
              {:else}
                <div class="grid-size-setting">
                  <span>Curve strength</span>
                  <div class="grid-size-control">
                    <FieldInteger id="workflow-curve-strength" label="Curve strength" value={curveStrengthDraft}
                      minimum={workflowCurveStrengthLimits.min} maximum={workflowCurveStrengthLimits.max} required invalid={curveStrengthInvalid}
                      describedBy={curveStrengthInvalid ? "workflow-curve-strength-error" : undefined}
                      onValueChange={value => { curveStrengthDraft = value; curveStrengthInvalid = false; }} onValueCommit={commitCurveStrength} />
                    <span aria-hidden="true">%</span>
                  </div>
                  {#if curveStrengthInvalid}<span class="grid-size-error" id="workflow-curve-strength-error" role="alert">Curve strength must be a whole number from {workflowCurveStrengthLimits.min} to {workflowCurveStrengthLimits.max}.</span>{/if}
                </div>
              {/if}
            </div>
          {/each}
          <div class="workflow-default-pair">
            <div class="grid-size-setting">
              <span>Node clearance</span>
              <div class="grid-size-control">
                <FieldInteger id="workflow-node-clearance" label="Node clearance" value={nodeClearanceDraft}
                  minimum={workflowNodeClearanceLimits.min} maximum={workflowNodeClearanceLimits.max} required invalid={nodeClearanceInvalid}
                  describedBy={nodeClearanceInvalid ? "workflow-node-clearance-error" : undefined}
                  onValueChange={value => { nodeClearanceDraft = value; nodeClearanceInvalid = false; }} onValueCommit={commitNodeClearance} />
                <span aria-hidden="true">px</span>
              </div>
              {#if nodeClearanceInvalid}<span class="grid-size-error" id="workflow-node-clearance-error" role="alert">Node clearance must be a whole number from {workflowNodeClearanceLimits.min} to {workflowNodeClearanceLimits.max}.</span>{/if}
            </div>
          </div>
          <div class="workflow-default-pair">
            <button class="workflow-default" type="button" role="switch" aria-checked={workflowDefaults.nodeSymbols}
              onclick={() => onWorkflowDefaultsChange({ ...workflowDefaults, nodeSymbols: !workflowDefaults.nodeSymbols })}>
              <span>Node symbols</span><span class="default-switch" aria-hidden="true"><span></span></span>
            </button>
          </div>
        </div>
        {#if workflowDefaultsError}
          <div class="defaults-error"><p role="alert">{workflowDefaultsError}</p><button class="defaults-retry" type="button" onclick={onRetryWorkflowDefaults}>Retry saving</button></div>
        {/if}
      </fieldset>
    </Disclosure>
  </div>
</section>

<style>
  .settings-sections { display: grid; gap: 12px; }
  .settings-sections :global(.settings-section) { border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-muted); transition: background-color 180ms ease-in; }
  .settings-sections :global(.settings-section:has(> summary[aria-expanded="true"])) { background: var(--color-catalog-active); }
  .settings-sections :global(.settings-section > summary) { background: transparent; color: var(--color-catalog-foreground); }
  .settings-sections :global(.settings-section > summary[aria-expanded="true"]) { color: var(--color-catalog-active-foreground); }
  .section-heading { display: grid; gap: 2px; }
  .section-heading h2 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: normal; }
  .section-subtitle { font-size: 12px; font-weight: 400; }
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; }
  .workflow-settings { container-type: inline-size; }
  .workflow-defaults { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .workflow-default-pair { display: grid; align-content: start; gap: 10px; min-width: 0; padding: 10px; border-radius: 4px; background: var(--color-surface); }
  .workflow-default { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 4px; background: var(--color-surface); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; text-align: left; }
  .workflow-default:focus-visible { outline-color: var(--color-ring); }
  .workflow-default-pair > .workflow-default { background: var(--color-background); }
  .grid-size-setting { display: grid; align-content: center; gap: 8px; min-width: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-background); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; }
  .grid-size-control { display: flex; align-items: center; gap: 8px; min-width: 0; --field-background: var(--color-background); --field-foreground: var(--color-catalog-foreground); }
  .grid-size-control :global(.field-integer) { flex: 1; min-width: 0; }
  .grid-size-error { color: var(--color-error-foreground); font-weight: 400; }
  .default-switch { flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .workflow-default[aria-checked="true"] .default-switch { background: var(--color-catalog-active); }
  .workflow-default[aria-checked="true"] .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  @container (max-width: 650px) { .workflow-defaults { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (max-width: 430px) { .workflow-defaults { grid-template-columns: 1fr; } }
  .defaults-error { display: grid; justify-items: start; gap: 10px; margin-top: 12px; }
  .defaults-error p { margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .defaults-retry { padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; }
  .settings-retry { padding: 16px 16px 0; }
  .palette-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 16px; }
  .palette-choice { position: relative; min-width: 0; cursor: var(--cursor-pointer, pointer); }
  .palette-choice input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: var(--cursor-pointer, pointer); }
  .palette-card { display: grid; padding: 0; border: 4px solid var(--color-muted); border-radius: 4px; background: var(--color-muted); color: var(--color-catalog-foreground); outline: 3px solid transparent; outline-offset: 3px; transition: border-color 180ms ease-in, background-color 180ms ease-in, color 180ms ease-in, outline-color 180ms ease-in; }
  input:checked + .palette-card { color: var(--color-catalog-active-foreground); }
  input:checked + .palette-card .palette-heading { background: var(--color-catalog-active); }
  input:focus-visible + .palette-card { outline-color: var(--color-ring); }
  .palette-heading { position: relative; display: grid; place-items: center; height: 37px; margin-top: -1px; padding: 1px 8px 0; background: var(--color-muted); text-align: center; transition: background-color 180ms ease-in; }
  .palette-heading strong { font-size: 13px; font-weight: 700; }
  .palette-swatches { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: hidden; }
  .palette-swatches > span { height: 108px; }
  .palette-swatches :global(.palette-selected-icon) { position: absolute; top: 50%; left: 50%; width: 64px; height: 64px; transform: translate(-50%, -50%) scale(0); color: var(--color-catalog-active); text-shadow: 0 2px 4px var(--color-catalog-active-foreground); font-variation-settings: "FILL" 1; transition: transform 180ms ease-in, color 180ms ease-in, text-shadow 180ms ease-in; pointer-events: none; }
  input:checked + .palette-card :global(.palette-selected-icon) { transform: translate(-50%, -50%) scale(1); transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease-in, text-shadow 180ms ease-in; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .palette-choice { z-index: 0; will-change: transform; transition: transform 180ms ease-in, z-index 0s linear 180ms; }
    .palette-choice:hover { z-index: 2; transform: scale(min(1.10, var(--hover-scale, 1.10))); transition-delay: 0s; }
  }
  @media (prefers-reduced-motion: reduce) { .palette-card, .palette-heading, .default-switch, .default-switch > span { transition: none; } }
</style>
