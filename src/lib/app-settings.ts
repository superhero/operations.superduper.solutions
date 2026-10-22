// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import { normalizeToolbarButtons, type ToolbarButtons } from "./toolbar-settings.ts";
import { normalizeKeybindings, type Keybindings } from "./keybindings.ts";
import { logger } from "./logger.ts";
import { reportStartup } from "./startup-progress.ts";
import { normalizeLocaleSettings, type LocaleSettings } from "./locale-settings.ts";
import { readAppearanceCache, writeAppearanceCache } from "./appearance-cache.ts";
import { defaultVaultPreferences, VaultError, type VaultPreferences } from "./secrets/types.ts";

import { appSettingsDatabaseName } from "./storage-names.ts";
export { appSettingsDatabaseName } from "./storage-names.ts";

import { isWorkflowLineStyle, type WorkflowLineStyle } from "./workflow-line-style.ts";
export type WorkflowDefaults = { dashed: boolean; curved: boolean; lineStyle?: WorkflowLineStyle; snap: boolean; nodeSymbols: boolean; gridSize: number; dashLength: number; dashGap: number; dashSpeed: number; curveStrength: number; nodeClearance: number };
export const workflowGridSizeLimits = { min: 1, max: 32 } as const;
export const workflowDashLengthLimits = { min: 1, max: 128 } as const;
export const workflowDashGapLimits = { min: 1, max: 128 } as const;
export const workflowDashSpeedLimits = { min: 0, max: 512 } as const;
export const workflowCurveStrengthLimits = { min: 0, max: 200 } as const;
export const workflowNodeClearanceLimits = { min: 0, max: 128 } as const;
export const defaultWorkflowSettings: Readonly<WorkflowDefaults> = { dashed: true, curved: true, snap: true, nodeSymbols: true, gridSize: 8, dashLength: 8, dashGap: 16, dashSpeed: 64, curveStrength: 100, nodeClearance: 16 };

export function isValidWorkflowGridSize(value: unknown): value is number
{
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    && value >= workflowGridSizeLimits.min && value <= workflowGridSizeLimits.max;
}

export function isValidWorkflowDashLength(value: unknown): value is number
{
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= workflowDashLengthLimits.min && value <= workflowDashLengthLimits.max;
}

export function isValidWorkflowDashGap(value: unknown): value is number
{
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= workflowDashGapLimits.min && value <= workflowDashGapLimits.max;
}

export function isValidWorkflowDashSpeed(value: unknown): value is number
{
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= workflowDashSpeedLimits.min && value <= workflowDashSpeedLimits.max;
}

export function isValidWorkflowCurveStrength(value: unknown): value is number
{
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= workflowCurveStrengthLimits.min && value <= workflowCurveStrengthLimits.max;
}

export function isValidWorkflowNodeClearance(value: unknown): value is number
{
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= workflowNodeClearanceLimits.min && value <= workflowNodeClearanceLimits.max;
}
type SettingValues = { toolbarButtons: ToolbarButtons; keybindings: Keybindings; theme: string; palette: string; workflowDefaults: WorkflowDefaults; developerToolbar: boolean; evaluationDetails: boolean; tooltips: boolean; locale: LocaleSettings; vaultPreferences?: VaultPreferences };

interface SettingsDatabase extends DBSchema
{
  settings: { key: keyof SettingValues; value: SettingValues[keyof SettingValues] };
  // Keep old stores usable while another tab holds their database open.
  preferences: { key: keyof SettingValues; value: SettingValues[keyof SettingValues] };
}

type StoreName = "settings" | "preferences";
type SettingsStore = IDBPTransaction<SettingsDatabase, [StoreName], "readwrite">["store"];
type SavedSettings = Partial<Record<keyof SettingValues, unknown>>;
type LegacySettings = { theme: string | null; palette: string | null };
const storageTimeout = 2500;
let connection: Promise<IDBPDatabase<SettingsDatabase>> | undefined;
let pending: Promise<void> = Promise.resolve();

type SettingsStorageStage = "open" | "read" | "write";

/** Keep browser failures intact for the error overlay and identify the failed step. */
export class SettingsStorageError extends Error
{
  readonly stage: SettingsStorageStage;

  constructor(stage: SettingsStorageStage, cause: unknown)
  {
    const origin = typeof location === "undefined" ? "this site's origin" : location.origin;
    const reason = cause instanceof Error || cause instanceof DOMException ? `${cause.name}: ${cause.message}` : String(cause);
    const action = { open: "open", read: "read from", write: "save to" }[stage];
    let guidance: string;
    if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "TimeoutError")
    {
      const possibleCause = stage === "open"
        ? "The browser has not confirmed whether saved settings are available. Possible causes include another tab holding a database connection open during an upgrade, another browser instance using the same profile, or an unresponsive browser storage service."
        : `The database opened, but ${stage === "read" ? "reading settings" : "saving your change"} did not finish. A pending write transaction or an unresponsive browser storage service may be delaying it.${stage === "write" ? " Your change could not be confirmed as saved." : ""}`;
      guidance = `${possibleCause}\n\nHow to recover:\n1. Close other tabs for this app, then retry.\n2. If this continues, save any work in your browser, fully quit all browser instances, and reopen ${origin} to retry.`;
    }
    else if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "SecurityError")
      guidance = `The browser denied storage access.\n\nHow to recover:\nCheck browser security or privacy settings and allow site storage for ${origin} before retrying.`;
    else if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "QuotaExceededError")
      guidance = "The browser reported that storage capacity was exceeded.\n\nHow to recover:\nFree device space or increase this site's storage allowance, then retry.";
    else
      guidance = `How to recover:\nRetry the operation. If it continues to fail, keep the browser error above when reporting the problem for this site.`;
    const summary = `Could not ${action} the saved-settings IndexedDB database.`;
    super(summary, { cause });
    this.name = "SettingsStorageError";
    this.stage = stage;
    // Keep a standard, single-line stack header for Visulima's stack parser.
    // The full message remains available without obscuring the real call frames.
    const stack = this.stack;
    this.message = `${summary}\n${reason}\n\n${guidance}`;
    if (stack) this.stack = stack;
  }
}

function storageError(stage: SettingsStorageStage, cause: unknown): SettingsStorageError
{
  return cause instanceof SettingsStorageError ? cause : new SettingsStorageError(stage, cause);
}

async function bounded<T>(operation: Promise<T>, stage: SettingsStorageStage, cancel: () => void): Promise<T>
{
  let timer: ReturnType<typeof setTimeout> | undefined;
  try
  {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try { cancel(); } catch { /* A completed transaction is already released. */ }
        const label = { open: "Opening saved settings", read: "Reading saved settings", write: "Saving settings" }[stage];
        reject(new DOMException(`${label} did not respond within ${storageTimeout / 1000} seconds.`, "TimeoutError"));
      }, storageTimeout);
    })]);
  }
  catch (error) { throw storageError(stage, error); }
  finally { clearTimeout(timer); }
}

function database()
{
  if (connection) return connection;
  let opened: IDBPDatabase<SettingsDatabase> | undefined;
  let expired = false;
  // A store rename must not make startup wait for every older tab to close.
  // Opening the current version supports both layouts without queuing an upgrade.
  const opening = Promise.resolve().then(() => openDB<SettingsDatabase>(appSettingsDatabaseName, undefined, {
    upgrade(database, oldVersion)
    {
      if (oldVersion === 0) database.createObjectStore("settings");
    },
    blocking() { opened?.close(); if (connection === request) connection = undefined; },
    terminated() { if (connection === request) connection = undefined; },
  }));
  // Open requests cannot be cancelled. Release connections that arrive too late.
  void opening.then(value => { opened = value; if (expired) value.close(); }, () => {});
  const request: Promise<IDBPDatabase<SettingsDatabase>> = bounded(opening, "open", () => { expired = true; })
    .catch(error => { if (connection === request) connection = undefined; throw error; });
  connection = request;
  return request;
}

async function inStore<Mode extends "readonly" | "readwrite", T>(mode: Mode,
  operation: (store: IDBPTransaction<SettingsDatabase, [StoreName], Mode>["store"]) => Promise<T>): Promise<T>
{
  const databaseConnection = await database();
  const name = databaseConnection.objectStoreNames.contains("settings") ? "settings" : "preferences";
  const stage = mode === "readonly" ? "read" : "write";
  let transaction: IDBPTransaction<SettingsDatabase, [StoreName], Mode> | undefined;
  try
  {
    const active = databaseConnection.transaction(name, mode);
    transaction = active;
    void active.done.catch(() => {});
    const work = Promise.all([operation(active.store), active.done]).then(([result]) => result);
    return await bounded(work, stage, () => active.abort());
  }
  catch (error)
  {
    try { transaction?.abort(); } catch { /* Already completed or aborted. */ }
    throw storageError(stage, error);
  }
}

async function readSettings(store: Pick<SettingsStore, "get">): Promise<SavedSettings>
{
  const [theme, palette, workflowDefaults, developerToolbar, evaluationDetails, tooltips, locale, keybindings, toolbarButtons] = await Promise.all([
    store.get("theme"), store.get("palette"), store.get("workflowDefaults"), store.get("developerToolbar"), store.get("evaluationDetails"), store.get("tooltips"), store.get("locale"), store.get("keybindings"), store.get("toolbarButtons"),
  ]);
  return { theme, palette, workflowDefaults, developerToolbar, evaluationDetails, tooltips, locale, keybindings, toolbarButtons };
}

function normalize(saved: SavedSettings, legacy: LegacySettings, paletteIds: readonly string[]): SettingValues
{
  const theme = (saved.theme ?? legacy.theme) === "dark" ? "dark" : "light";
  const candidate = saved.palette ?? legacy.palette;
  const palette = typeof candidate === "string" && paletteIds.includes(candidate) ? candidate : "default";
  const workflow = saved.workflowDefaults && typeof saved.workflowDefaults === "object"
    ? saved.workflowDefaults as Partial<WorkflowDefaults> : defaultWorkflowSettings;
  return { theme, palette, toolbarButtons: normalizeToolbarButtons(saved.toolbarButtons), keybindings: normalizeKeybindings(saved.keybindings), developerToolbar: saved.developerToolbar === true, evaluationDetails: saved.evaluationDetails === true, tooltips: saved.tooltips !== false, locale: normalizeLocaleSettings(saved.locale), workflowDefaults: {
    dashed: typeof workflow.dashed === "boolean" ? workflow.dashed : defaultWorkflowSettings.dashed,
    curved: typeof workflow.curved === "boolean" ? workflow.curved : defaultWorkflowSettings.curved,
    ...(isWorkflowLineStyle(workflow.lineStyle) ? { lineStyle: workflow.lineStyle, curved: workflow.lineStyle !== "orthogonal" } : {}),
    snap: typeof workflow.snap === "boolean" ? workflow.snap : defaultWorkflowSettings.snap,
    nodeSymbols: typeof workflow.nodeSymbols === "boolean" ? workflow.nodeSymbols : defaultWorkflowSettings.nodeSymbols,
    gridSize: isValidWorkflowGridSize(workflow.gridSize) ? workflow.gridSize : defaultWorkflowSettings.gridSize,
    dashLength: isValidWorkflowDashLength(workflow.dashLength) ? workflow.dashLength : defaultWorkflowSettings.dashLength,
    dashGap: isValidWorkflowDashGap(workflow.dashGap) ? workflow.dashGap : defaultWorkflowSettings.dashGap,
    dashSpeed: isValidWorkflowDashSpeed(workflow.dashSpeed) ? workflow.dashSpeed : defaultWorkflowSettings.dashSpeed,
    curveStrength: isValidWorkflowCurveStrength(workflow.curveStrength) ? workflow.curveStrength : defaultWorkflowSettings.curveStrength,
    nodeClearance: isValidWorkflowNodeClearance(workflow.nodeClearance) ? workflow.nodeClearance : defaultWorkflowSettings.nodeClearance,
  } };
}

function matchesWorkflowDefaults(value: unknown, expected: WorkflowDefaults): boolean
{
  const entries = Object.entries(expected);
  return value !== null && typeof value === "object" && Object.keys(value).length === entries.length
    && entries.every(([key, setting]) => Reflect.get(value, key) === setting);
}

function migrateSettings(legacy: LegacySettings, paletteIds: readonly string[]): void
{
  pending = pending.catch(() => {}).then(async () => {
    await inStore("readwrite", async store => {
      // Re-read under the write lock: another tab may have changed a setting
      // since startup read it. Never write our stale startup snapshot back.
      const current = await readSettings(store);
      const settings = normalize(current, legacy, paletteIds);
      if (current.theme !== settings.theme) await store.put(settings.theme, "theme");
      if (current.palette !== settings.palette) await store.put(settings.palette, "palette");
      if (!matchesWorkflowDefaults(current.workflowDefaults, settings.workflowDefaults))
        await store.put(settings.workflowDefaults, "workflowDefaults");
    });
    try
    {
      for (const key of ["theme", "palette"] as const)
        if (legacy[key] !== null && localStorage.getItem(`operations-${key}`) === legacy[key])
          localStorage.removeItem(`operations-${key}`);
    }
    catch { /* Retry cleanup after a later successful migration. */ }
  });
  void pending.catch(error => logger.warn("Could not migrate saved settings; existing settings were retained.", error));
}

/** Read saved settings without waiting for schema changes or migration writes. */
export async function loadSettings(paletteIds: readonly string[]): Promise<SettingValues & { storageError: Error | null }>
{
  const legacy: LegacySettings = { theme: null, palette: null };
  try
  {
    legacy.theme = localStorage.getItem("operations-theme");
    legacy.palette = localStorage.getItem("operations-palette");
  }
  catch { /* IndexedDB remains usable when legacy storage is blocked. */ }
  try
  {
    reportStartup("settings-storage");
    await database();
    reportStartup("settings");
    const saved = await inStore("readonly", readSettings);
    const settings = normalize(saved, legacy, paletteIds);
    if (saved.theme !== settings.theme || saved.palette !== settings.palette
      || !matchesWorkflowDefaults(saved.workflowDefaults, settings.workflowDefaults)
      || legacy.theme !== null || legacy.palette !== null) migrateSettings(legacy, paletteIds);
    writeAppearanceCache(settings);
    return { ...settings, storageError: null };
  }
  catch (error)
  {
    return { ...normalize({}, legacy, paletteIds), ...readAppearanceCache(paletteIds), storageError: storageError("read", error) };
  }
}

/** Keep rapid changes ordered and update only the setting that changed. */
export function saveSetting<Key extends keyof SettingValues>(key: Key, value: SettingValues[Key]): Promise<void>
{
  const snapshot = typeof value === "object" ? { ...value } : value;
  pending = pending.catch(() => {}).then(async () => {
    const appearance = await inStore("readwrite", async store => {
      await store.put(snapshot, key);
      if (key !== "theme" && key !== "palette") return null;
      const [theme, palette] = await Promise.all([store.get("theme"), store.get("palette")]);
      return { theme, palette };
    });
    if (appearance) writeAppearanceCache(appearance);
  });
  return pending;
}

/** Independent lazy read: secret access does not make general startup depend on the vault. */
export async function readVaultPreferences(): Promise<VaultPreferences> {
  const value = await inStore("readonly", store => store.get("vaultPreferences"));
  return validateVaultPreferences(value ?? defaultVaultPreferences);
}
export function validateVaultPreferences(value: unknown): VaultPreferences {
  if (!value || typeof value !== "object") throw new VaultError("INVALID");
  const prefs = value as VaultPreferences;
  if (typeof prefs.idleLockEnabled !== "boolean" || !Number.isInteger(prefs.idleLockMinutes)
    || prefs.idleLockMinutes < 1 || prefs.idleLockMinutes > 10080) throw new VaultError("INVALID");
  return { idleLockEnabled: prefs.idleLockEnabled, idleLockMinutes: prefs.idleLockMinutes };
}
