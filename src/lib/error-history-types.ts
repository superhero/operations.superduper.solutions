// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export type ErrorOrigin = {
  source: "application" | "runtime" | "rejection" | "worker";
  scope?: string | undefined;
  operation?: string;
  filename?: string;
  line?: number;
  column?: number;
};

/** A bounded diagnostic snapshot; never arbitrary application data or logger context. */
export type ErrorDetail = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: ErrorDetail;
  errors?: ErrorDetail[];
};
export type ErrorDiagnostic = { identity: string; origin: ErrorOrigin; error: ErrorDetail };
export type ErrorOccurrence = ErrorDiagnostic & { firstSeen: number; lastSeen: number; occurrences: number };
export type ErrorHistoryRecord = ErrorOccurrence & { id: number };
export type ErrorHistoryPage = { entries: ErrorHistoryRecord[]; total: number };
export const errorHistoryLimit = 1_000;
export const errorHistoryPageSize = 25;
