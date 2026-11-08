// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFile } from 'node:fs/promises';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { nativeAgentFixture } from './native-agent.fixture.mjs';

/** Owned synthetic delivery only: this fixture never contacts the feedback service. */
export async function nativeFeedbackFixture(options = {}) {
  const create = options.allowAgent ? nativeAgentFixture : nativeHostFixture;
  return create({ ...options, allowFeedback: options.allowFeedback ?? true, onFrame(frame, f, emit) {
    if (frame.method !== 'feedback/upload') return options.onFrame?.(frame, f, emit);
    f.feedbackCalls = (f.feedbackCalls ?? 0) + 1;
    void (async () => {
      try {
        f.frozenPaths = frame.params.extraLogFiles ?? [];
        f.attachmentBytes = await Promise.all(f.frozenPaths.map(path => readFile(path)));
        f.deliveries = (f.deliveries ?? 0) + 1;
        const reply = () => emit(f.failFeedback ? { id: frame.id, error: { code: -32000, message: 'Synthetic private upload failure' } }
          : { id: frame.id, result: f.feedbackResult ?? { threadId: frame.params.threadId ?? 'no-active-thread-fixture', promptHash: null } });
        if (f.holdFeedback) f.release.push(reply); else reply();
      } catch { emit({ id: frame.id, error: { code: -32000, message: 'Synthetic attachment failure' } }); }
    })();
    return true;
  } });
}
