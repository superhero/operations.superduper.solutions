// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import * as report from './lib/operation-report.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';

// Optional paired historical implementation, loaded outside the timed interval.
const reference = process.env.SCHEMA_PROFILE_REFERENCE
  ? await import(pathToFileURL(process.env.SCHEMA_PROFILE_REFERENCE).href) : undefined;
const inspector = new Session(); inspector.connect();
function measure(implementation, document, operations) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const projections = [];
  for (let index = 0; index < operations.length; index += 16) {
    const scope = implementation.createOperationSchemaScoper?.(document)
      ?? ((path, method, allow) => implementation.scopeOperationSchema(document, path, method, allow));
    for (const operation of operations.slice(index, index + 16)) projections.push(scope(operation.path, operation.method, true));
  }
  const elapsedMs = performance.now() - started;
  const afterProjectionHeap = process.memoryUsage().heapUsed;
  const json = JSON.stringify(projections);
  return { elapsedMs, beforeHeap, afterProjectionHeap, bytes: Buffer.byteLength(json),
    signature: createHash('sha256').update(json).digest('hex') };
}
async function measureModels(document, id, operations, batchSize) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const stagesMs = { adaptation: 0, origin: 0, projection: 0, approval: 0, accounting: 0 };
  const models = [], fingerprints = [];
  const started = performance.now();
  for (let index = 0; index < operations.length; index += batchSize) {
    for (const descriptor of operations.slice(index, index + batchSize)) {
      let start = performance.now();
      const operation = inspectServiceSchema(document, id, new Set([descriptor.id]), descriptor).operations[0];
      stagesMs.adaptation += performance.now() - start;
      start = performance.now();
      const origin = operationServerUrl(document, operation);
      stagesMs.origin += performance.now() - start;
      start = performance.now();
      const { schema } = report.scopeOperationSchema(document, operation.path, operation.method, true);
      stagesMs.projection += performance.now() - start;
      start = performance.now();
      try { fingerprints.push((await approvedOperation(operation, origin)).fingerprint); }
      catch (error) { if (error.code !== 'PERMISSION') throw error; fingerprints.push(null); }
      stagesMs.approval += performance.now() - start;
      start = performance.now();
      const bytes = new TextEncoder().encode(JSON.stringify([operation, schema])).byteLength;
      stagesMs.accounting += performance.now() - start;
      models.push({ operation, document: schema, origin, bytes });
    }
  }
  const elapsedMs = performance.now() - started;
  const afterModelsHeap = process.memoryUsage().heapUsed;
  return { elapsedMs, stagesMs, beforeHeap, afterModelsHeap,
    signature: createHash('sha256').update(JSON.stringify([models, fingerprints])).digest('hex') };
}
const measurements = [], modelMeasurements = [];
try {
  for (const id of ['openai', 'cloudflare']) {
    const document = JSON.parse(gunzipSync(readFileSync(`src/catalogs/services/${id}.json.gz`)));
    const available = inspectServiceSchema(document, id).operations.filter(operation => !operation.unavailableReason);
    const operations = Array.from({ length: 32 }, (_, index) => available[Math.floor(index * (available.length - 1) / 31)]);
    const modes = { current: report, ...(reference ? { reference } : {}) };
    const samples = Object.fromEntries(Object.keys(modes).map(mode => [mode, []]));
    let signature, bytes;
    for (let sample = 0; sample < 6; sample++) {
      const order = Object.entries(modes); if (sample % 2) order.reverse();
      for (const [mode, implementation] of order) {
        await inspector.post('HeapProfiler.collectGarbage');
        const result = measure(implementation, document, operations);
        await inspector.post('HeapProfiler.collectGarbage');
        result.afterReleaseHeap = process.memoryUsage().heapUsed;
        signature ??= result.signature; bytes ??= result.bytes;
        if (signature !== result.signature) throw new Error('Canonical projection differs from its reference');
        if (sample) samples[mode].push(result);
      }
    }
    const batches = [];
    for (const batchSize of [1, 8, 16]) {
      const samples = [];
      for (let sample = 0; sample < 3; sample++) {
        await inspector.post('HeapProfiler.collectGarbage');
        const result = await measureModels(document, id, operations, batchSize);
        await inspector.post('HeapProfiler.collectGarbage');
        result.afterReleaseHeap = process.memoryUsage().heapUsed;
        samples.push(result);
      }
      batches.push({ batchSize, samples });
    }
    if (new Set(batches.flatMap(batch => batch.samples.map(sample => sample.signature))).size !== 1)
      throw new Error('Batch size changed the canonical models or approvals');
    modelMeasurements.push({ id, operationCount: operations.length, batches });
    measurements.push({ id, batchSize: 16, operationIds: operations.map(operation => operation.id),
      samplesMs: samples.current.map(sample => sample.elapsedMs), bytes, signature, samples });
  }
} finally { inspector.disconnect(); }
parentPort.postMessage({ node: process.version, measurements, modelMeasurements, memory: process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS });
