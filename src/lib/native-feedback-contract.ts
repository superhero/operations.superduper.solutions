// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeRuntimeLimits } from './native-runtime-contract.ts';

export const nativeFeedbackMethod = 'feedback/upload';
export const nativeFeedbackLimits = { files: 8, fileBytes: 2 * 1024 * 1024, attachmentBytes: 8 * 1024 * 1024, requestMs: 310_000 } as const;
type Property = Record<string, unknown>;
export function nativeFeedbackInputSchema(): { type: string; additionalProperties: false; properties: Record<string, Property>; required: string[] } {
  return { type: 'object', additionalProperties: false, properties: {
    classification: { type: 'string', minLength: 1, maxLength: 128, title: 'Classification' },
    reason: { type: ['string', 'null'], maxLength: 8192, title: 'Feedback message' },
    threadId: { type: ['string', 'null'], maxLength: 192, title: 'Owned thread ID', description: 'Optional thread created by this companion generation and account.' },
    includeLogs: { type: 'boolean', default: false, title: 'Share runtime diagnostics', description: 'Consent to send runtime logs, diagnostic metadata and owned thread rollouts to OpenAI feedback. Requires the host diagnostics opt-in.' },
    extraLogFiles: { type: ['array', 'null'], maxItems: nativeFeedbackLimits.files, title: 'Share workspace files', description: 'Explicitly selected workspace files to attach. Maximum 2 MiB each and 8 MiB total; requires the host diagnostics opt-in.', items: { type: 'string', maxLength: 4096 } },
    tags: { type: ['object', 'null'], maxProperties: 32, title: 'Feedback tags', additionalProperties: { type: 'string', maxLength: 1024 } }
  }, required: ['classification'] };
}
export function nativeFeedbackParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid feedback inputs.');
  const params = nativeObject(value, Object.keys(value)), allowed = nativeFeedbackInputSchema().properties;
  if (Object.keys(params).some(key => !Object.hasOwn(allowed, key))) throw new Error('Unsupported feedback input.');
  const text = (v: unknown, max: number, multiline = false): v is string => typeof v === 'string' && v.isWellFormed() && v.length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v);
  if (!text(params.classification, 128) || !params.classification.trim()) throw new Error('Feedback classification is required.');
  if (params.reason != null && !text(params.reason, 8192, true)) throw new Error('Invalid feedback message.');
  if (params.threadId != null && (!text(params.threadId, 192) || !/^[A-Za-z0-9_-]{1,192}$/.test(params.threadId))) throw new Error('Invalid feedback thread.');
  if (params.includeLogs !== undefined && typeof params.includeLogs !== 'boolean') throw new Error('Invalid diagnostics consent.');
  if (params.extraLogFiles != null && (!Array.isArray(params.extraLogFiles) || params.extraLogFiles.length > nativeFeedbackLimits.files
    || params.extraLogFiles.some(path => !text(path, 4096) || !path))) throw new Error('Invalid feedback attachments.');
  if (params.tags != null) {
    if (typeof params.tags !== 'object' || Array.isArray(params.tags)) throw new Error('Invalid feedback tags.');
    const tags = nativeObject(params.tags, Object.keys(params.tags));
    if (Object.keys(tags).length > 32 || Object.entries(tags).some(([key, v]) => !text(key, 128) || !key || !text(v, 1024))) throw new Error('Invalid feedback tags.');
  }
  const result = { ...structuredClone(params), includeLogs: params.includeLogs ?? false };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > nativeRuntimeLimits.frame / 2) throw new Error('Feedback inputs exceed the native frame budget.');
  return result;
}
export function publicNativeFeedbackResult(value: unknown): Record<string, unknown> {
  const hasHash = !!value && typeof value === 'object' && Object.hasOwn(value, 'promptHash');
  const result = nativeObject(value, ['threadId', ...(hasHash ? ['promptHash'] : [])]);
  if (typeof result.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(result.threadId)
    || hasHash && result.promptHash !== null && (typeof result.promptHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.promptHash))) throw new Error('Invalid feedback result.');
  return structuredClone(result);
}
