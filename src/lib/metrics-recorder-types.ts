// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { MetricsBar } from "./metrics-history.ts";
import type { PageMemoryReport } from "./page-memory.ts";
import type { StorageReport } from "./storage-metrics-types.d.ts";
import type { WindowMetrics } from "./storage-metrics.ts";

export type RecorderPhase = "starting" | "measuring" | "collecting" | "waiting" | "unavailable";
export type RecorderSnapshot = {
  phase: RecorderPhase;
  report: StorageReport | null;
  pageMemory: PageMemoryReport | null;
  activeBar: MetricsBar | null;
  error: string | null;
  historyError: string | null;
};
export type RecorderState = RecorderSnapshot & { bars: MetricsBar[] };
export type RecorderMessage =
  | { type: "measure"; id: number }
  | { type: "snapshot"; snapshot: RecorderSnapshot }
  | { type: "history"; bars: MetricsBar[] }
  | { type: "saved"; bars: MetricsBar[] };
export type RecorderReply = { type: "measured"; id: number; pageMemory: PageMemoryReport; windowMetrics: WindowMetrics };
