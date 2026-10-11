// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type LocaleSettings = {
  dateFormat: "system" | "dmy" | "mdy" | "ymd" | "long";
  timeFormat: "system" | "12h" | "24h";
  timeZone: string;
};

export const defaultLocaleSettings: LocaleSettings = {
  dateFormat: "system",
  timeFormat: "system",
  timeZone: "system",
};

export function normalizeLocaleSettings(value: unknown): LocaleSettings
{
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const dateFormat = source.dateFormat;
  const timeFormat = source.timeFormat;
  let timeZone = "system";
  if (typeof source.timeZone === "string" && source.timeZone !== "system")
  {
    try
    {
      new Intl.DateTimeFormat(undefined, { timeZone: source.timeZone });
      timeZone = source.timeZone;
    }
    catch { /* A removed or invalid zone falls back to the browser. */ }
  }
  return {
    dateFormat: dateFormat === "dmy" || dateFormat === "mdy" || dateFormat === "ymd" || dateFormat === "long"
      ? dateFormat : "system",
    timeFormat: timeFormat === "12h" || timeFormat === "24h" ? timeFormat : "system",
    timeZone,
  };
}

/** Include UTC and the browser's zone, which may not appear in the canonical list. */
export function getTimeZoneOptions(): string[]
{
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set(["UTC", new Intl.DateTimeFormat().resolvedOptions().timeZone, ...supported])].sort();
}

function timeOptions(settings: LocaleSettings): Intl.DateTimeFormatOptions
{
  return {
    hour: settings.timeFormat === "24h" ? "2-digit" : "numeric",
    minute: settings.timeFormat === "system" ? "numeric" : "2-digit",
    second: settings.timeFormat === "system" ? "numeric" : "2-digit",
    ...(settings.timeFormat === "12h" ? { hourCycle: "h12" }
      : settings.timeFormat === "24h" ? { hourCycle: "h23" } : {}),
  };
}

function dateOptions(settings: LocaleSettings): Intl.DateTimeFormatOptions
{
  return { year: "numeric", month: settings.dateFormat === "long" ? "long" : "numeric", day: "numeric" };
}

function formatPattern(date: Date, settings: LocaleSettings, timeZone: Intl.DateTimeFormatOptions): string
{
  // Fixed patterns intentionally keep Gregorian years and Latin digits in every locale.
  const parts = new Intl.DateTimeFormat("en", {
    ...timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)!.value;
  const year = part("year").padStart(4, "0");
  const month = part("month");
  const day = part("day");
  if (settings.dateFormat === "dmy") return `${day}/${month}/${year}`;
  if (settings.dateFormat === "mdy") return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

/** Format an instant in the selected zone, leaving browser defaults unspecified. */
export function formatDateTime(
  timestamp: number,
  settings: LocaleSettings = defaultLocaleSettings,
  locales?: Intl.LocalesArgument,
): string
{
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  const zone = settings.timeZone === "system" ? {} : { timeZone: settings.timeZone };
  if (settings.dateFormat === "system" || settings.dateFormat === "long")
    return new Intl.DateTimeFormat(locales, { ...zone, ...dateOptions(settings), ...timeOptions(settings) }).format(date);
  return `${formatPattern(date, settings, zone)}, ${new Intl.DateTimeFormat(locales, { ...zone, ...timeOptions(settings) }).format(date)}`;
}

/** A YYYY-MM-DD calendar date has no zone and must never move to an adjacent day. */
export function formatCalendarDate(
  value: string,
  settings: LocaleSettings = defaultLocaleSettings,
  locales?: Intl.LocalesArgument,
): string
{
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Unavailable";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "Unavailable";
  const zone = { timeZone: "UTC" };
  return settings.dateFormat === "system" || settings.dateFormat === "long"
    ? new Intl.DateTimeFormat(locales, { ...zone, ...dateOptions(settings) }).format(date)
    : formatPattern(date, settings, zone);
}
