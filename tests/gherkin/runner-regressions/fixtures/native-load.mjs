// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Externalized by the fixture project: Node owns this module cache even when
// Vitest deliberately reevaluates a setup file before each feature.
export const loadNative = href => import(href);
