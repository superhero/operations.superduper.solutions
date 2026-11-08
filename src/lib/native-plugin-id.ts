// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** Pinned SDK remote identifier grammar; backend generations use different prefixes. */
export const isNativePluginRemoteId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_~-]+$/.test(value);
