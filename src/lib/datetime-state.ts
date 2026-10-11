// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { fromStore, writable } from "svelte/store";
import { defaultLocaleSettings, normalizeLocaleSettings } from "./locale-settings.ts";
import type { LocaleSettings } from "./locale-settings.ts";

const settings = writable<LocaleSettings>({ ...defaultLocaleSettings });
const currentSettings = fromStore(settings);

/** Reading inside a Svelte expression subscribes that display to preference changes. */
export function getLocaleSettings(): LocaleSettings
{
  return currentSettings.current;
}

export function applyLocaleSettings(value: unknown): void
{
  settings.set(normalizeLocaleSettings(value));
}
