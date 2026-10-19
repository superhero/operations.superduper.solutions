// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import * as matching from './lib/matching.ts';

// Native module execution avoids measuring Vitest's VM/global lookup overhead
// inside the distance loop. Correctness still runs through the Gherkin oracle.
const { operations, queries, signatures, resultSignatures, profile } = workerData;
const start = performance.now();
const prepared = matching.prepareMatchingOperations(operations);
const evaluate = query => matching.evaluatePreparedOperations(query, prepared);
const compact = query => matching.evaluatePreparedOperations(query, prepared, false);
const indexPreparationMs = performance.now() - start;
// Optional paired baseline runs in this same native worker, alternating order.
const reference = process.env.SCHEMA_PROFILE_MATCHING_REFERENCE
  ? await import(pathToFileURL(process.env.SCHEMA_PROFILE_MATCHING_REFERENCE).href) : undefined;
const referencePrepared = reference?.prepareMatchingOperations(operations);
// Warm both modes before collecting either mode's samples.
for (let sample = 0; sample < 3; sample++) for (const query of queries.slice(0, 4)) {
  evaluate(query); compact(query); reference?.evaluatePreparedOperations(query, referencePrepared, false);
}
const searches = queries.map((query, index) => {
  evaluate(query); // Warm each query before timing it.
  const samplesMs = [], compactSamplesMs = [], cpuMs = [], compactCpuMs = [], referenceSamplesMs = [], referenceCpuMs = [];
  let actual;
  for (let sample = 0; sample < 5; sample++) {
    // Alternate modes within each pair; scheduling delays are reported separately
    // from this native worker thread's CPU consumption.
    const order = ['full', 'compact', ...(reference ? ['reference'] : [])];
    if (sample % 2) order.reverse();
    for (const mode of order) {
      const cpuStarted = process.threadCpuUsage();
      const started = performance.now();
      const result = mode === 'full' ? evaluate(query) : mode === 'compact' ? compact(query)
        : reference.evaluatePreparedOperations(query, referencePrepared, false);
      const elapsed = performance.now() - started;
      const cpu = process.threadCpuUsage(cpuStarted);
      if (mode === 'full') {
        actual = result; samplesMs.push(elapsed); cpuMs.push((cpu.user + cpu.system) / 1000);
        assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), signatures[index]);
      } else {
        (mode === 'reference' ? referenceSamplesMs : compactSamplesMs).push(elapsed);
        (mode === 'reference' ? referenceCpuMs : compactCpuMs).push((cpu.user + cpu.system) / 1000);
        assert.equal(createHash('sha256').update(JSON.stringify(result.results)).digest('hex'), resultSignatures[index]);
      }
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[2];
  return { query, compactSamplesMs, compactMedianMs: median(compactSamplesMs), medianMs: median(samplesMs), samplesMs,
    cpuMs, compactCpuMs, medianCpuMs: median(cpuMs), compactMedianCpuMs: median(compactCpuMs),
    ...(reference ? { referenceSamplesMs, referenceCpuMs, referenceMedianMs: median(referenceSamplesMs), referenceMedianCpuMs: median(referenceCpuMs) } : {}),
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
    for (let sample = 0; sample < 5; sample++) for (const query of queries.slice(0, 4)) compact(query);
    cpuProfile = (await inspector.post('Profiler.stop')).profile;
  } finally { inspector.disconnect(); }
}
parentPort.postMessage({ indexPreparationMs, searches, memory: process.memoryUsage(), profiledMode: profile ? 'compact' : null, cpuProfile });
