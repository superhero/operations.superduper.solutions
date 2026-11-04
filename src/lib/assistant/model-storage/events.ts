// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Opening ordinary Settings does not create a channel or a database. */
export function createModelEvents() {
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    publish() {
      notify();
      if (typeof BroadcastChannel === 'undefined') return;
      const target = channel ?? new BroadcastChannel('operations-ai-models-v1');
      target.postMessage('changed');
      if (target !== channel) target.close();
    },
    subscribe(listener: () => void) {
      if (!channel && typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('operations-ai-models-v1');
        channel.onmessage = notify;
      }
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = undefined; } };
    },
  };
}
