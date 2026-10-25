// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { vi } from 'vitest';

/** Exercise the real request deadline while a transport or response is pending. */
export async function assertRequestDeadline(execute, check, { body = false } = {}) {
  vi.useFakeTimers();
  let entered, calls = 0, settled = false, cancelled = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const fetchRequest = (_url, { signal }) => {
    calls++;
    if (body) return Promise.resolve(new Response(new ReadableStream({
      pull() { entered(); return new Promise(() => {}); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } }));
    entered();
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
  try {
    const pending = execute(fetchRequest);
    pending.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(pending, check);
    await ready;
    await vi.advanceTimersByTimeAsync(14_999);
    assert.equal(settled, false, 'An ordinary request retains its full 15-second deadline.');
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    assert.equal(calls, 1, 'A timed-out request must not be replayed.');
    if (body) assert.equal(cancelled, true, 'The pending response reader is cancelled.');
  } finally { vi.useRealTimers(); }
}
