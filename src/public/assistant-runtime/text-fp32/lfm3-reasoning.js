// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** LFM3's trained prefix uses an implicit or explicit <think> opening.
 * Parse one reasoning/answer boundary; never remove arbitrary HTML or answer tags.
 * The optional implicit opening is necessary for measured Paris</think>Paris.
 */
export function splitLFM3Reasoning(content, nativeReasoning = '') {
  if (typeof content !== 'string' || typeof nativeReasoning !== 'string') throw Error('LFM3 content and reasoning must be strings');
  const close = content.indexOf('</think>');
  if (close >= 0) {
    let thought = content.slice(0, close);
    if (thought.startsWith('<think>')) thought = thought.slice(7);
    return {text:content.slice(close + 8), reasoning:[nativeReasoning, thought].filter(Boolean).join('\n')};
  }
  // A truncated explicit reasoning block is never presented as an answer.
  if (content.startsWith('<think>')) return {text:'', reasoning:[nativeReasoning, content.slice(7)].filter(Boolean).join('\n')};
  return {text:content, reasoning:nativeReasoning};
}
