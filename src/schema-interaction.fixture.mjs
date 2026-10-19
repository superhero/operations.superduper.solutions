// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { createMatchingIndexCache } from './lib/matching-index.ts';
import { prepareMatchingOperations } from './lib/matching.ts';

const { operations, schema } = workerData;
const cache = createMatchingIndexCache();
const started = performance.now();
let previous = cache.prepare(operations);
const coldMs = performance.now() - started;
const fullMs = [], incrementalMs = [];
let retainedSchemas = 0, updatedOperations = 0;
for (let sample = 0; sample < 6; sample++) {
  const next = operations.map(operation => operation.id.startsWith(`${schema}:`) ? { ...operation, name: `${operation.name} revision ${sample}` } : operation);
  const fullStarted = performance.now();
  const expected = prepareMatchingOperations(next);
  const fullDuration = performance.now() - fullStarted;
  const incrementalStarted = performance.now();
  const actual = cache.prepare(next);
  const incrementalDuration = performance.now() - incrementalStarted;
  assert.deepEqual(actual.catalogs.flatMap(catalog => catalog.prepared), expected);
  retainedSchemas = actual.catalogs.filter(catalog => previous.catalogs.includes(catalog)).length;
  updatedOperations = actual.catalogs.find(catalog => catalog.id === schema).prepared.length;
  previous = actual;
  if (sample) { fullMs.push(fullDuration); incrementalMs.push(incrementalDuration); }
}
const median = samples => [...samples].sort((a, b) => a - b)[2];
parentPort.postMessage({ operations: operations.length, schemas: previous.catalogs.length, schema, updatedOperations,
  retainedSchemas, coldMs, fullMs, incrementalMs, fullMedianMs: median(fullMs), incrementalMedianMs: median(incrementalMs) });
