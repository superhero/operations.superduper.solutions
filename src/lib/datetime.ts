// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export function formatLocalDateTime(timestamp: number): string
{
  return new Date(timestamp).toLocaleString(navigator.languages);
}

export function formatLocalDate(date: string): string
{
  // Calendar dates have no time zone; parsing ISO as UTC can change the day.
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(navigator.languages);
}
