// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const appearanceCacheKey = "v1/settings/appearance-cache";
type Appearance = { theme: "light" | "dark"; palette: string };

function isAppearance(value: unknown): value is Appearance
{
  if (!value || typeof value !== "object") return false;
  const appearance = value as Partial<Appearance>;
  return (appearance.theme === "light" || appearance.theme === "dark")
    && typeof appearance.palette === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(appearance.palette);
}

/** A startup hint only. Never import this cache into IndexedDB. */
export function readAppearanceCache(paletteIds: readonly string[]): Appearance | null
{
  try
  {
    const value: unknown = JSON.parse(localStorage.getItem(appearanceCacheKey) ?? "null");
    return isAppearance(value) && Reflect.get(value, "version") === 1 && paletteIds.includes(value.palette)
      ? { theme: value.theme, palette: value.palette } : null;
  }
  catch { return null; }
}

/** Refresh only from a successful IndexedDB read or committed write. */
export function writeAppearanceCache(value: unknown): void
{
  try
  {
    if (isAppearance(value)) localStorage.setItem(appearanceCacheKey,
      JSON.stringify({ version: 1, theme: value.theme, palette: value.palette }));
  }
  catch { /* A blocked or full cache must never prevent saving settings. */ }
}
