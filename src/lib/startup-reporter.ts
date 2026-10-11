// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { StartupStage } from "./startup-progress.ts";

let reporter: ((stage: StartupStage, detail?: string) => void) | undefined;

export function setStartupReporter(value: typeof reporter): void { reporter = value; }
export function reportStartup(stage: StartupStage, detail?: string): void { reporter?.(stage, detail); }
