// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { parentPort, workerData } from 'node:worker_threads';
import * as matching from './lib/matching.ts';

// Native module execution avoids measuring Vitest's VM/global lookup overhead
// inside the distance loop. Correctness still runs through the Gherkin oracle.
const { operations, queries, signatures, profile } = workerData;
const start = performance.now();
const evaluate = typeof matching.createOperationMatcher === 'function'
  ? matching.createOperationMatcher(operations) : query => matching.evaluateOperations(query, operations);
const indexPreparationMs = performance.now() - start;
const searches = queries.map((query, index) => {
  evaluate(query); // Warm each query before timing it.
  const samplesMs = [];
  let actual;
  for (let sample = 0; sample < 5; sample++) {
    const started = performance.now();
    actual = evaluate(query);
    samplesMs.push(performance.now() - started);
    assert.equal(createHash('sha256').update(JSON.stringify(actual)).digest('hex'), signatures[index]);
  }
  return { query, medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs,
    candidates: actual.candidates.length, results: actual.results.length };
});
let cpuProfile;
if (profile) {
  const inspector = new Session();
  inspector.connect();
  try {
    await inspector.post('Profiler.enable');
    await inspector.post('Profiler.setSamplingInterval', { interval: 1000 });
    await inspector.post('Profiler.start');
    for (let sample = 0; sample < 5; sample++) for (const query of queries.slice(0, 4)) evaluate(query);
    cpuProfile = (await inspector.post('Profiler.stop')).profile;
  } finally { inspector.disconnect(); }
}
parentPort.postMessage({ indexPreparationMs, searches, memory: process.memoryUsage(), cpuProfile });
