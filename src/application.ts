// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mount, tick, unmount } from "svelte";
import { startApplication } from "./bootstrap.ts";
import { loadSettings } from "./lib/app-settings.ts";
import { applyLocaleSettings } from "./lib/datetime-state.ts";
import { finishStartup, reportStartup } from "./lib/startup-progress.ts";
import { requestPersistentStorage } from "./lib/storage-persistence.ts";
import { startMetricsRecorder } from "./lib/metrics-recorder.ts";
import { startErrorHistory } from "./lib/error-history.ts";
import { prepareSavedStorage, loadSchemaLibrary } from "./lib/schema-library.ts";

export async function initializeApplication(): Promise<void> {
  try {
    startErrorHistory();
    reportStartup("application");
    // Keep the CSS loader visible while developing it; remove the query to start.
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("dev-loading") === "1") {
      await new Promise<never>(() => {});
    }
    if (import.meta.env.DEV) {
      const { initErrorOverlayContext } = await import("./dev/error-overlay-context.ts");
      initErrorOverlayContext();
    }
    void requestPersistentStorage();
    reportStartup("settings-storage");
    await prepareSavedStorage();
    const [{ default: App }, { palettes }] = await Promise.all([
      import("./App.svelte"), import("./components/SettingsWorkspace.svelte"),
    ]);
    const settings = await loadSettings(palettes.map(palette => palette.id));
    reportStartup("apply-settings");
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.palette = settings.palette;
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
    applyLocaleSettings(settings.locale);
    reportStartup("schemas");
    await loadSchemaLibrary();
    reportStartup("interface");
    startApplication(document, App, (component, options) => mount(component, { ...options, props: {
      initialWorkflowDefaults: settings.workflowDefaults,
      initialDeveloperToolbar: settings.developerToolbar,
      initialEvaluationDetails: settings.evaluationDetails,
      initialTooltips: settings.tooltips,
      initialLocale: settings.locale,
      initialKeybindings: settings.keybindings,
      initialToolbarButtons: settings.toolbarButtons,
      initialSettingsPaneWidth: settings.settingsPaneWidth,
      initialSettingsError: settings.storageError,
    } }));
    await tick();
    startMetricsRecorder();
    if (settings.storageError) finishStartup(settings.storageError);

    if (import.meta.env.DEV) {
      const { initToolbarTheme } = await import("./dev/toolbar-theme.ts");
      initToolbarTheme();
      const { default: DevTooltips } = await import("./dev/DevTooltips.svelte");
      const tooltips = mount(DevTooltips, { target: document.body });
      import.meta.hot?.dispose(() => { void unmount(tooltips); });
    }
  } catch (error) {
    finishStartup(error);
    // The dependency-free entry owns recovery before there is an application UI.
    if (!document.getElementById("app")?.hasChildNodes()) throw error;
  }
}
