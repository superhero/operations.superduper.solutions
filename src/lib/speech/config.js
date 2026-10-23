// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import modelLock from './model.lock.json';
export { modelLock };
export const speechPreferenceKey = 'v1/settings/speech';
export const largeModelCache = 'operations-parakeet-models-v1';
export const sampleRate = 16000;
export const recordingLimit = 55;
export const initializationDeadline = 120000;
export const downloadIdleDeadline = 120000;
export const downloadDeadline = 1200000;
export const speechProfiles = [
  { value: 'cpu', label: 'CPU · INT8', bytes: 670488135, encoder: 'encoder-model.int8.onnx', files: ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt'] },
  { value: 'gpu-fp32', label: 'WebGPU · FP32 encoder', bytes: 2495495162, encoder: 'encoder-model.onnx', files: ['encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx', 'vocab.txt'] },
];
export function speechPreferences(value) {
  return { mode: value?.mode === 'gpu-fp32' ? 'gpu-fp32' : 'cpu', restore: value?.restore !== false, loaded: value?.loaded === true, refine: value?.refine === true };
}

// Only append newly confirmed words. A user's edits to their draft survive
// later partials; provisional ASR never replaces a typed message.
export function appendDictation(draft, previous, confirmed, limit = 16000) {
  if (!confirmed.startsWith(previous)) return { draft, confirmed: previous, truncated: false };
  const suffix = confirmed.slice(previous.length).trimStart();
  const next = suffix ? `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${suffix}` : draft;
  return { draft: next.slice(0, limit), confirmed, truncated: next.length > limit };
}
