// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const appSettingsDatabaseName = "operations-preferences-v1";

export type WorkflowDefaults = { dashed: boolean; curved: boolean; snap: boolean; gridSize: number };
export const workflowGridSizeLimits = { min: 1, max: 96 } as const;
export const defaultWorkflowSettings: Readonly<WorkflowDefaults> = { dashed: false, curved: false, snap: false, gridSize: 12 };

export function isValidWorkflowGridSize(value: unknown): value is number
{
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    && value >= workflowGridSizeLimits.min && value <= workflowGridSizeLimits.max;
}
type SettingValues = { theme: string; palette: string; workflowDefaults: WorkflowDefaults };

interface SettingsDatabase extends DBSchema
{
  settings: { key: keyof SettingValues; value: SettingValues[keyof SettingValues] };
  // Version 1 store, used only during the upgrade.
  preferences: { key: "theme" | "palette"; value: string };
}

let connection: Promise<IDBPDatabase<SettingsDatabase>> | undefined;
let pending: Promise<void> = Promise.resolve();

function database()
{
  // Keep the database identifier stable so existing saved settings upgrade in place.
  connection ??= openDB<SettingsDatabase>(appSettingsDatabaseName, 2, {
    upgrade(database, oldVersion, _newVersion, transaction)
    {
      if (oldVersion === 1) transaction.objectStore("preferences").name = "settings";
      else database.createObjectStore("settings");
    },
    blocking() { void connection?.then(database => database.close()); connection = undefined; },
    terminated() { connection = undefined; },
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

/** Read and migrate settings before the editor can change them. */
export async function loadSettings(paletteIds: readonly string[])
{
  const defaults = { theme: "light", palette: "default", workflowDefaults: { ...defaultWorkflowSettings } };
  try
  {
    const databaseConnection = await database();
    let legacyTheme: string | null = null;
    let legacyPalette: string | null = null;
    try
    {
      legacyTheme = localStorage.getItem("operations-theme");
      legacyPalette = localStorage.getItem("operations-palette");
    }
    catch { /* IndexedDB remains usable when legacy storage is blocked. */ }
    const transaction = databaseConnection.transaction("settings", "readwrite");
    void transaction.done.catch(() => {});
    const savedTheme = await transaction.store.get("theme");
    const savedPalette = await transaction.store.get("palette");
    const savedWorkflowDefaults = await transaction.store.get("workflowDefaults");
    const theme = (savedTheme ?? legacyTheme) === "dark" ? "dark" : "light";
    const candidate = savedPalette ?? legacyPalette ?? defaults.palette;
    const palette = typeof candidate === "string" && paletteIds.includes(candidate) ? candidate : defaults.palette;
    const saved = savedWorkflowDefaults && typeof savedWorkflowDefaults === "object" ? savedWorkflowDefaults : defaultWorkflowSettings;
    const workflowDefaults: WorkflowDefaults = {
      dashed: typeof saved.dashed === "boolean" ? saved.dashed : defaultWorkflowSettings.dashed,
      curved: typeof saved.curved === "boolean" ? saved.curved : defaultWorkflowSettings.curved,
      snap: typeof saved.snap === "boolean" ? saved.snap : defaultWorkflowSettings.snap,
      gridSize: isValidWorkflowGridSize(saved.gridSize) ? saved.gridSize : defaultWorkflowSettings.gridSize,
    };
    await transaction.store.put(theme, "theme");
    await transaction.store.put(palette, "palette");
    await transaction.store.put(workflowDefaults, "workflowDefaults");
    await transaction.done;
    try
    {
      localStorage.removeItem("operations-theme");
      localStorage.removeItem("operations-palette");
    }
    catch { /* Retry legacy cleanup on the next load; IndexedDB takes precedence. */ }
    return { theme, palette, workflowDefaults };
  }
  catch { return defaults; }
}

/** Keep rapid changes ordered and update only the setting that changed. */
export function saveSetting<Key extends keyof SettingValues>(key: Key, value: SettingValues[Key]): Promise<void>
{
  const snapshot = typeof value === "object" ? { ...value } : value;
  pending = pending.catch(() => {}).then(async () => {
    const databaseConnection = await database();
    await databaseConnection.put("settings", snapshot, key);
  });
  return pending;
}
