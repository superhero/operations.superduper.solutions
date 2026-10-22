// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const paneStateKey = "v1/settings/pane-state";
export const settingsSections = ["toolbar", "keybindings", "secrets", "theme", "locale", "logs", "schemas", "workflow", "storage", "developer"] as const;
export type SettingsSection = typeof settingsSections[number] | null;
export type NavigationPaneState = {
  prompt: string; catalogPath: string[]; workflowsOpen: boolean; matchingOpen: boolean;
  searchExpansion: Record<string, boolean>; scrollTop: number;
};
export type PaneState = {
  version: 1; navigationOpen: boolean; settingsOpen: boolean; lastOpenedPane: "navigation" | "settings";
  navigation: NavigationPaneState; settings: { section: SettingsSection; scrollTop: number };
};

export const emptyNavigationState = (): NavigationPaneState => ({
  prompt: "", catalogPath: [], workflowsOpen: false, matchingOpen: false, searchExpansion: {}, scrollTop: 0,
});
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scroll = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(10_000_000, Math.max(0, value)) : 0;

/** Disposable interface state; preferred widths and other settings remain in IndexedDB. */
export function readPaneState(): PaneState | null {
  try {
    const raw = localStorage.getItem(paneStateKey);
    if (!raw || raw.length > 200_000) return null;
    const saved = object(JSON.parse(raw));
    if (saved.version !== 1 || typeof saved.navigationOpen !== "boolean" || typeof saved.settingsOpen !== "boolean") return null;
    const navigation = object(saved.navigation), settings = object(saved.settings);
    return {
      version: 1, navigationOpen: saved.navigationOpen, settingsOpen: saved.settingsOpen,
      lastOpenedPane: saved.lastOpenedPane === "settings" ? "settings" : "navigation",
      navigation: {
        prompt: typeof navigation.prompt === "string" ? navigation.prompt.slice(0, 240) : "",
        catalogPath: Array.isArray(navigation.catalogPath) ? navigation.catalogPath.filter((id): id is string => typeof id === "string" && id.length <= 2048).slice(0, 64) : [],
        workflowsOpen: navigation.workflowsOpen === true, matchingOpen: navigation.matchingOpen === true,
        searchExpansion: Object.fromEntries(Object.entries(object(navigation.searchExpansion)).filter(([key, value]) => key.length <= 8192 && typeof value === "boolean").slice(0, 256)) as Record<string, boolean>,
        scrollTop: scroll(navigation.scrollTop),
      },
      settings: { section: settingsSections.includes(settings.section as Exclude<SettingsSection, null>) ? settings.section as SettingsSection : null, scrollTop: scroll(settings.scrollTop) },
    };
  } catch { return null; }
}

let pending: PaneState | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
export function savePaneState(state: PaneState): void {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flushPaneState, 150);
}

/** Synchronous page-hide flush also preserves the last scroll before an immediate refresh. */
export function flushPaneState(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!pending) return;
  try { localStorage.setItem(paneStateKey, JSON.stringify(pending)); }
  catch { /* Restricted or full storage must leave the interface usable. */ }
  pending = undefined;
}
