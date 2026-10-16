// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { defaultVaultPreferences, VaultError } from "./types.ts";
import type { VaultPreferences } from "./types.ts";

type Options = {
  now: () => number;
  onLock: () => void;
  onDeadline: (expires: number | null) => void;
  preferences?: VaultPreferences;
};

function preferences(value: VaultPreferences): VaultPreferences {
  if (!value || typeof value.idleLockEnabled !== "boolean" || !Number.isInteger(value.idleLockMinutes)
    || value.idleLockMinutes < 1 || value.idleLockMinutes > 10080) throw new VaultError("INVALID");
  return { idleLockEnabled: value.idleLockEnabled, idleLockMinutes: value.idleLockMinutes };
}

/** The client owns visibility events/timers; the worker receives absolute deadlines. */
export function createVaultLifecycle(options: Options) {
  let prefs = preferences(options.preferences ?? defaultVaultPreferences);
  let active = false;
  let lastActivity = 0;
  let lastObserved = 0;
  let expires: number | null = null;
  function publish() { options.onDeadline(expires); }
  function deactivate() {
    if (!active) return;
    active = false;
    expires = null;
    publish();
  }
  function lock() {
    if (!active) return;
    try { deactivate(); }
    finally { options.onLock(); }
  }
  function observe(time: number): boolean {
    if (!active) return false;
    if (!Number.isFinite(time) || time < lastObserved || (expires !== null && time >= expires)) {
      lock();
      return false;
    }
    lastObserved = time;
    return true;
  }
  function updateDeadline(time: number) {
    expires = prefs.idleLockEnabled ? lastActivity + prefs.idleLockMinutes * 60_000 : null;
    if (expires !== null && (!Number.isSafeInteger(expires) || time >= expires)) lock();
    else publish();
  }
  return {
    /** Only call after a fresh successful unlock, never merely on visibility. */
    activate() {
      const time = options.now();
      if (!Number.isSafeInteger(time) || time < 0) {
        lock();
        throw new VaultError("INVALID");
      }
      active = true;
      lastActivity = lastObserved = time;
      updateDeadline(time);
    },
    activity(trusted: boolean, visible: boolean) {
      const time = options.now();
      // An event delivered after suspension cannot revive an expired session.
      if (!observe(time) || trusted !== true || visible !== true) return;
      lastActivity = time;
      updateDeadline(time);
    },
    configure(value: VaultPreferences) {
      const next = preferences(value);
      const time = options.now();
      const wasActive = observe(time);
      prefs = next;
      // Changing the setting is not user activity and cannot reset its origin.
      if (wasActive) updateDeadline(time);
    },
    check() { return observe(options.now()); },
    deactivate,
    deadline() { return expires; },
  };
}
