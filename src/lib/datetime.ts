// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { getLocaleSettings } from "./datetime-state.ts";
import { formatCalendarDate, formatDateTime } from "./locale-settings.ts";

export function formatLocalDateTime(timestamp: number): string
{
  return formatDateTime(timestamp, getLocaleSettings(), navigator.languages);
}

export function formatLocalDate(date: string): string
{
  return formatCalendarDate(date, getLocaleSettings(), navigator.languages);
}
