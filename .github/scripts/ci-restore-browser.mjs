// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { restoreBrowserUnits } from './ci-browser.mjs';
try { await restoreBrowserUnits(); }
catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
