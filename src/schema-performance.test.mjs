// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { Then } from '@cucumber/cucumber';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import * as matching from './lib/matching.ts';

// Independent oracle for the pre-optimization public matching contract.
const normalize = value => value.normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function referenceSimilarity(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) current[column] = Math.min(current[column - 1] + 1,
      previous[column] + 1, previous[column - 1] + Number(left[row - 1] !== right[column - 1]));
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}
function referenceEvaluation(prompt, operations) {
  const query = normalize(prompt);
  if (!query || query.length > 256) return { candidates: [], results: [] };
  const candidates = operations.map(operation => ({ operation, similarity: Math.max(...[
    operation.name, operation.id, operation.id.slice(operation.id.indexOf(':') + 1)
  ].map(name => referenceSimilarity(query, normalize(name)))) }))
    .sort((left, right) => right.similarity - left.similarity || left.operation.id.localeCompare(right.operation.id));
  return { candidates, results: candidates.filter((candidate, index) => index < 5 || candidate.similarity > 0.5) };
}

Then('indexed matching retains exact scores for varied Unicode names and queries', () => {
  let seed = 19;
  const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  const alphabet = ['a', 'b', 'é', 'é', '中', '𝔄', 'A', '_', '1', '🦄'];
  const word = () => Array.from({ length: random(17) }, () => alphabet[random(alphabet.length)]).join('');
  const names = ['', 'a', 'aa', 'aaa', 'aaaa', 'prefix shared suffix', 'prefix changed suffix',
    'CaseFold', 'Ｈｅｌｌｏ', '中 文', ...Array.from({ length: 90 }, word)];
  const operations = names.map((name, position) => ({ name, id: position % 2 ? `unicode:${position}` : `no_colon_${position}` }));
  const evaluate = matching.createOperationMatcher(operations);
  for (const query of [...names, '', '  ', 'x'.repeat(257)]) {
    const expected = referenceEvaluation(query, operations);
    assert.deepEqual(evaluate(query), expected);
    assert.deepEqual(matching.evaluateOperations(query, operations), expected);
  }
  const unread = [{ id: 'unread', get name() { assert.fail('Empty and over-limit queries must not read candidate names'); } }];
  assert.deepEqual(matching.evaluateOperations('', unread), { candidates: [], results: [] });
  assert.deepEqual(matching.evaluateOperations('x'.repeat(257), unread), { candidates: [], results: [] });
});

Then('the complete service catalogue is profiled with unchanged matching results', { timeout: 120_000 }, async function () {
  const directory = resolve('src/catalogs/services');
  const descriptors = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'));
  const operations = [];
  const preparation = [];
  for (const descriptor of descriptors) {
    const started = performance.now();
    const document = JSON.parse(gunzipSync(await readFile(resolve(directory, `${descriptor.id}.json.gz`))));
    const inspected = inspectServiceSchema(document, descriptor.id);
    assert.equal(inspected.operations.length, descriptor.operations);
    operations.push(...inspected.operations.map(({ id, name }) => ({ id, name })));
    preparation.push({ id: descriptor.id, operations: inspected.operations.length, durationMs: performance.now() - started });
  }
  assert.equal(new Set(operations.map(operation => operation.id)).size, operations.length);
  assert.equal(operations.length, descriptors.reduce((total, source) => total + source.operations, 0));
  const evaluate = typeof matching.createOperationMatcher === 'function' ? matching.createOperationMatcher(operations)
    : query => matching.evaluateOperations(query, operations);
  const queries = ['List projects', 'Create a new project', 'get',
    'List all running virtual machines in the selected project', 'LIST_projetcs', 'Élément ＧＥＴ 😀', '', 'x'.repeat(257)];
  const signatures = [];
  for (const query of queries) {
    const expected = referenceEvaluation(query, operations);
    assert.deepEqual(evaluate(query), expected);
    signatures.push(createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
  }
  const directoryOutput = process.env.SCHEMA_PROFILE_OUTPUT;
  const worker = new Worker(pathToFileURL(resolve('src/schema-performance.fixture.mjs')), {
    workerData: { operations, queries, signatures, profile: !!directoryOutput },
  });
  let measured;
  try {
    measured = await new Promise((resolveResult, reject) => {
      worker.once('message', resolveResult);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`The matching benchmark ended without a result (${code}).`)));
    });
  } finally { await worker.terminate(); }
  const { cpuProfile, ...timings } = measured;
  const report = { label: process.env.SCHEMA_PROFILE_LABEL ?? 'current', node: process.version,
    execution: 'native-worker', schemaCount: descriptors.length, operationCount: operations.length, preparation, ...timings,
    profiledSamples: cpuProfile?.samples?.length ?? 0 };
  await this.attach(JSON.stringify(report), 'application/vnd.operations.schema-performance+json');
  if (directoryOutput) {
    await mkdir(directoryOutput, { recursive: true });
    await writeFile(resolve(directoryOutput, 'source.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(resolve(directoryOutput, 'search.cpuprofile'), JSON.stringify(cpuProfile));
  }
});
