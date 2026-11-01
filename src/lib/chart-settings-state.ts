// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { writable } from "svelte/store";
import { defaultChartSettings } from "./chart-settings.ts";
export const chartSettingsState = writable(defaultChartSettings);
