// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { loadNative } from './native-load.mjs';
const positive = ['positive', 'retry', 'worker', 'statuses'].includes(process.env.OPERATIONS_RUNNER_FIXTURE_MODE);
const steps = process.env.OPERATIONS_RUNNER_FIXTURE_MODE === 'hook-errors'
  ? './steps-hook-errors.mjs' : positive ? './steps-positive.mjs' : './steps-contracts.mjs';
await loadNative(new URL(steps, import.meta.url).href);
