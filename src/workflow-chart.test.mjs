// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { readJsonStream } from './lib/workflow-json-stream.ts';
import { streamLimits } from './lib/workflow-response-stream.ts';
import { emptyChartSnapshot } from './lib/workflow-chart.ts';
import { chartPalette, chartIdentityStyle, chartNamedStyles, chartSeriesName } from './lib/workflow-chart-presentation.ts';
import smallExample from '../examples/workflow-charts.json' with { type: 'json' };
import expandedExample from '../examples/workflow-charts-expanded.json' with { type: 'json' };
import { chartKinds, defaultChartData, validateChartData, chartPoints, chartSnapshot, chartConfigurationKey, chartInputs, updateChartSnapshot } from './lib/workflow-chart.ts';
import { createUtilityNode } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { copyWorkflowSelection, pasteWorkflowSelection } from './lib/workflow-clipboard.ts';
import { isValueConnection, isWorkflowConnectionTypeCompatible } from './lib/workflow-utilities.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { parseWorkflowFile, defaultCsvOptions } from './lib/workflow-file.ts';
import { defaultProcessingData } from './lib/workflow-processing.ts';
import { describeWorkflowChange } from './lib/workflow-change-message.ts';
import { defaultToolbarButtons, normalizeToolbarButtons } from './lib/toolbar-settings.ts';

const chart = (id = 'chart', patch = {}) => ({ ...createUtilityNode('chart', { x: 360, y: 0 }, id), data: { ...defaultChartData(), ...patch } });
const file = value => ({ id: 'file', type: 'file', position: { x: 0, y: 0 }, data: { file: parseWorkflowFile('samples.json', JSON.stringify(value), defaultCsvOptions) } });
const edge = (source, target, sourceHandle = 'value', targetHandle = 'value') => ({ id: `${source}-${sourceHandle}-${target}-${targetHandle}`, kind: 'mapping', source, target, sourceHandle, targetHandle });
const doc = (nodes, edges = [], id = 'charts') => ({ version: 3, id, name: 'Charts', description: '', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });

Then('visualization configuration validates bounded ports and restores legacy defaults', () => {
  const data = defaultChartData();
  const legacy = validateChartData({ ...data, series: undefined, columns: undefined, nodePath: undefined,
    sourcePath: undefined, targetPath: undefined, weightPath: undefined });
  assert.deepEqual(legacy.series, [{ id: 'value', name: data.title, xPath: '', yPath: '' }]);
  for (const key of ['columns', 'nodePath', 'sourcePath', 'targetPath', 'weightPath']) assert.deepEqual(legacy[key], data[key]);
  for (const series of [{}, [], Array(17).fill(data.series[0]), [null], [{ ...data.series[0], id: 1 }], [{ ...data.series[0], id: 'bad identity' }]])
    assert.throws(() => validateChartData({ ...data, series }));
  const column = { id: 'value', label: 'Value', path: '' };
  for (const columns of [{}, Array(33).fill(column), [null], [column, column]])
    assert.throws(() => validateChartData({ ...data, columns }));
});

Then('visualization snapshots bound malformed inputs and retain legacy text safely', () => {
  const data = defaultChartData();
  for (const value of [undefined, null]) assert.deepEqual(chartSnapshot('chart', 'scope', data, value).series[0].points, []);
  assert.deepEqual(chartSnapshot('chart', 'scope', data, 3).series[0].points, [{ x: 1, y: 3 }]);
  assert.match(updateChartSnapshot(undefined, 'chart', 'scope', data, 'missing', 1).error, /^missing: The selected view has no such input/);
  const table = { ...data, kind: 'table', columns: [{ id: 'value', label: 'Value', path: '' }] };
  for (const value of [Symbol('hidden'), { toJSON: () => undefined }]) assert.deepEqual(chartSnapshot('chart', 'scope', table, [value]).rows, [['']]);
  assert.match(chartSnapshot('chart', 'scope', table, [{ toJSON: () => { throw 'unavailable'; } }]).error, /connected value could not be displayed/);
  const legacy = { ...emptyChartSnapshot('chart', 'scope', table), rows: [['001']], rowTypes: undefined };
  const appended = updateChartSnapshot(legacy, 'chart', 'scope', table, 'rows', [2], true);
  assert.deepEqual(appended.rows, [['001'], ['2']]); assert.deepEqual(appended.rowTypes, [['text'], ['number']]);
  const stale = { ...emptyChartSnapshot('chart', 'scope', data), errors: { graph: 'retained' } };
  assert.equal(updateChartSnapshot(stale, 'chart', 'scope', data, 'value', 1).error, 'graph: retained');
  const sankey = { ...data, kind: 'sankey', maxPoints: 1 };
  assert.match(updateChartSnapshot(undefined, 'chart', 'scope', sankey, 'nodes', ['a', 'b']).error, /node collection exceeds/);
  assert.match(updateChartSnapshot(undefined, 'chart', 'scope', sankey, 'links', [{}, {}]).error, /link collection exceeds/);
  assert.match(updateChartSnapshot(undefined, 'chart', 'scope', { ...sankey, maxPoints: 2 }, 'nodes', ['a', 'a']).error, /names must be unique/);
  for (const value of ['1', NaN]) assert.match(updateChartSnapshot(undefined, 'chart', 'scope', sankey, 'links', [{ source: 'a', target: 'b', value }]).error, /finite nonnegative/);
  const duplicated = { ...emptyChartSnapshot('chart', 'scope', sankey), nodes: [{ name: 'a' }, { name: 'a' }] };
  assert.match(updateChartSnapshot(duplicated, 'chart', 'scope', sankey, 'links', []).error, /^Sankey: Sankey node names must be unique/);
});

const jsonResponse = chunks => new Response(new ReadableStream({ start(controller) {
  for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  controller.close();
} }));
const streamError = (response, code, sse = false, options = {}) => assert.rejects(
  readJsonStream(response, sse, options.signal ?? new AbortController().signal, options.onProgress, options.onValue),
  error => error.code === code);

Then('JSON stream readers preserve complete endings and reject invalid bounded input', async () => {
  assert.equal((await readJsonStream(jsonResponse([' \n1']), false, new AbortController().signal)).body, 1);
  assert.equal((await readJsonStream(jsonResponse(['event\r\ndata:1\r\n\r\n']), true, new AbortController().signal)).body, 1);
  assert.equal((await readJsonStream(jsonResponse(['data:1\r']), true, new AbortController().signal)).stream.events, 0);
  for (const chunk of ['nope\n', new Uint8Array([0xff]), new Uint8Array([0xc2])]) await streamError(jsonResponse([chunk]), 'FRAME');
  for (const ending of ['\n', '']) await streamError(jsonResponse(['x'.repeat(streamLimits.frameCharacters + 1) + ending]), 'LIMIT');
  await streamError(jsonResponse(['data:' + ' '.repeat(streamLimits.frameCharacters / 2) + '\n', 'data:' + ' '.repeat(streamLimits.frameCharacters / 2 + 1) + '\n']), 'LIMIT', true);
  await streamError(jsonResponse([new Uint8Array(streamLimits.bytes + 1)]), 'LIMIT');
  await streamError(jsonResponse(Array.from({ length: 1025 }, () => new Uint8Array())), 'LIMIT');
});

Then('JSON stream readers cancel at delivery boundaries and release failed readers', async () => {
  const aborted = new AbortController(); aborted.abort();
  await streamError(new Response(null), 'CANCELLED', false, { signal: aborted.signal });
  const cancelFailure = () => Promise.reject(new Error('cancel unavailable'));
  const unopened = new Response(new ReadableStream({ cancel: cancelFailure }));
  await streamError(unopened, 'CANCELLED', false, { signal: aborted.signal });
  await streamError(new Response(null), 'INCOMPLETE');
  const delivery = new AbortController(), values = [];
  const response = jsonResponse(['1\n2\n']);
  await streamError(response, 'CANCELLED', false, { signal: delivery.signal, onValue: value => { values.push(value.body); delivery.abort(); } });
  assert.deepEqual(values, [1]); assert.equal(response.body.locked, false);
  const progress = new AbortController();
  await streamError(jsonResponse(['1\n']), 'CANCELLED', false, { signal: progress.signal, onProgress: () => progress.abort() });
  const invalid = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('invalid\n')); }, cancel: cancelFailure }));
  await streamError(invalid, 'FRAME'); assert.equal(invalid.body.locked, false);
  vi.useFakeTimers();
  try {
    const pending = new Response(new ReadableStream());
    const rejected = streamError(pending, 'IDLE');
    await vi.advanceTimersByTimeAsync(streamLimits.idleMs);
    await rejected; assert.equal(pending.body.locked, false);
  } finally { vi.useRealTimers(); }
});

Then('chart configuration accepts supported views and rejects invalid settings', () => {
  for (const kind of chartKinds) assert.equal(validateChartData({ ...defaultChartData(), kind }).kind, kind);
  assert.equal(defaultToolbarButtons.chart, true);
  assert.equal(normalizeToolbarButtons({ chart: false }).chart, false);
  assert.equal(normalizeToolbarButtons({}).chart, true);
  for (const invalid of [null, [], false, { title: '' }, { title: ' '.repeat(3) }, { title: 'x'.repeat(121) }, { kind: 'html' },
    { xAxis: 'logarithm' }, { xPath: 'time' }, { yPath: '/bad~2escape' }, { yPath: 3 }, { xPath: '/'.repeat(513) },
    { maxPoints: 0 }, { maxPoints: 2001 }, { maxPoints: 1.5 }, { maxPoints: '10' }, { width: 359 }, { width: Infinity }, { height: 1601 }]) {
    assert.throws(() => validateChartData(invalid === null || Array.isArray(invalid) || invalid === false ? invalid : { ...defaultChartData(), ...invalid }));
  }
  const clean = validateChartData({ ...defaultChartData(), points: [123], option: '<unsafe>' });
  assert.equal(Object.hasOwn(clean, 'points'), false);
  assert.equal(Object.hasOwn(clean, 'option'), false);
});

Then('chart mapping uses JSON pointers without coercing invalid numbers', () => {
  const data = { ...defaultChartData(), xPath: '/a~1b/~0name', yPath: '/value' };
  assert.deepEqual(chartPoints([{ 'a/b': { '~name': 'zero' }, value: 0 }, { 'a/b': { '~name': 'gap' }, value: null }], data),
    [{ x: 'zero', y: 0 }, { x: 'gap', y: null }]);
  assert.deepEqual(chartPoints([2, 0, -1, null], defaultChartData()).map(point => point.y), [2, 0, -1, null]);
  assert.deepEqual(chartPoints(0, defaultChartData()), [{ x: 1, y: 0 }]);
  assert.deepEqual(chartPoints(null, defaultChartData()), []);
  assert.deepEqual(chartPoints(undefined, defaultChartData()), []);
  for (const value of ['2', false, {}, Infinity, NaN]) assert.throws(() => chartPoints([value], defaultChartData()), /finite numbers/);
  assert.throws(() => chartPoints([-1], { ...defaultChartData(), kind: 'pie' }), /nonnegative/);
  assert.match(chartSnapshot('chart', 'scope', defaultChartData(), ['invalid']).error, /numeric field/);
});

Then('chart axes validate coordinates and keep only the latest configured points', () => {
  assert.deepEqual(chartPoints([1, 2, 3, 4], { ...defaultChartData(), maxPoints: 2 }), [{ x: 3, y: 3 }, { x: 4, y: 4 }]);
  const data = { ...defaultChartData(), xAxis: 'time', xPath: '/time', yPath: '/value' };
  assert.equal(chartPoints([{ time: '2026-10-26T12:00:00Z', value: 3 }], data)[0].x, Date.parse('2026-10-26T12:00:00Z'));
  assert.equal(chartPoints([{ time: 12345, value: 3 }], data)[0].x, 12345);
  for (const time of ['later', '2026-99-99T12:00:00Z', Infinity, null]) assert.throws(() => chartPoints([{ time, value: 3 }], data), /Time fields/);
  assert.equal(chartPoints([{ time: 0, value: 3 }], { ...data, xAxis: 'value' })[0].x, 0);
  assert.throws(() => chartPoints([{ time: '3', value: 3 }], { ...data, xAxis: 'value' }), /Numeric X/);
  for (const time of [undefined, false, {}, 'x'.repeat(201)]) assert.throws(() => chartPoints([{ time, value: 3 }], { ...data, xAxis: 'category' }), /Label fields/);
  assert.equal(chartConfigurationKey(data), chartConfigurationKey({ ...data, title: 'Renamed', width: 900 }));
  assert.notEqual(chartConfigurationKey(data), chartConfigurationKey({ ...data, yPath: '/other' }));
});

Then('chart configuration survives import export and independent clipboard identities', () => {
  const original = doc([file([1, 2]), chart('chart', { kind: 'area', title: 'Requests', maxPoints: 12, width: 620 })], [edge('file', 'chart')]);
  const parsed = parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(original)));
  assert.deepEqual(parsed, original);
  let counter = 0;
  const copied = copyWorkflowSelection(original, ['file', 'chart'], []);
  const pasted = pasteWorkflowSelection(copied, 32, () => `pasted-${++counter}`);
  const restored = validateWorkflowDocument({ ...original, ...pasted });
  assert.equal(restored.nodes.find(node => node.type === 'chart').data.width, 620);
  assert.notEqual(restored.nodes[0].id, original.nodes[0].id);
  assert.equal(restored.edges[0].target, restored.nodes.find(node => node.type === 'chart').id);
  assert.throws(() => validateWorkflowDocument({ ...original, version: 2 }), /Unsupported workflow node type/);
});

Then('chart ports accept JSON data and reject private or incompatible direct sources', () => {
  const target = chart();
  const nodes = [file([1, 2]), target];
  assert.equal(isValueConnection(edge('file', 'chart'), ...nodes), true);
  assert.equal(isWorkflowConnectionTypeCompatible(edge('file', 'chart'), nodes, []), true);
  assert.equal(isValueConnection(edge('chart', 'file'), target, nodes[0]), false);
  assert.equal(isValueConnection(edge('file', 'chart', 'value', 'other'), ...nodes), false);
  const vault = { ...createUtilityNode('vault', { x: 0, y: 0 }, 'vault'), data: { credentialId: '10000000-0000-4000-8000-000000000001' } };
  assert.equal(isValueConnection(edge('vault', 'chart'), vault, target), false);
  for (const type of ['Number', 'Integer', 'Array', 'Object', 'Null', 'Text', 'Boolean', 'Binary']) {
    const output = { id: 'output', type: 'data', position: { x: 0, y: 0 }, data: { ownerId: 'api', direction: 'outputs',
      label: 'Body', fields: [{ id: 'value', type, connectable: true }] } };
    assert.equal(isWorkflowConnectionTypeCompatible(edge('output', 'chart'), [output, target], []), !['Text', 'Boolean', 'Binary'].includes(type), type);
  }
});

Then('a file to chart workflow completes with transient bounded chart results', async () => {
  const original = doc([file([1, 2, 3]), chart('chart', { maxPoints: 2 })], [edge('file', 'chart')]);
  const before = JSON.stringify(original);
  const runner = createWorkflowRunner(original);
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.deepEqual(runner.chartResults[0].series[0].points, [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
  runner.chartResults[0].series[0].points[0].y = 99;
  assert.equal(runner.chartResults[0].series[0].points[0].y, 2);
  assert.equal(JSON.stringify(original), before);
  assert.equal(JSON.stringify(portableWorkflowDocument(original)).includes('points'), false);
  assert.equal((await createWorkflowRunner(doc([chart()])).nextAsync()).kind, 'complete');
});

Then('malformed chart input produces an honest chart error without failing execution', async () => {
  const runner = createWorkflowRunner(doc([file(['bad']), chart()], [edge('file', 'chart')]));
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.match(runner.chartResults[0].error, /finite numbers/);
  assert.deepEqual(runner.chartResults[0].series, []);
});

Then('inactive chart branches leave no chart results', async () => {
  const gate = { ...createUtilityNode('switch', { x: 160, y: 0 }, 'switch'), data: { gates: [{ id: 'no', operator: '==', value: '999' }] } };
  const runner = createWorkflowRunner(doc([file(1), gate, chart()], [edge('file', 'switch'), edge('switch', 'chart', 'no')]));
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.deepEqual(runner.chartResults, []);
});

Then('chart sinks withhold private vault processing values', async () => {
  const vault = { ...createUtilityNode('vault', { x: 0, y: 0 }, 'vault'), data: { credentialId: '10000000-0000-4000-8000-000000000001' } };
  const transform = { ...createUtilityNode('transform', { x: 160, y: 0 }, 'transform'), data: defaultProcessingData('transform', 'base64_encode') };
  const runner = createWorkflowRunner(doc([vault, transform, chart()], [edge('vault', 'transform'), edge('transform', 'chart', 'result')]));
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.equal(runner.chartResults[0].error, 'Private vault values cannot be displayed in charts.');
  assert.equal(JSON.stringify(runner.chartResults).includes(vault.data.credentialId), false);
  assert.equal(JSON.stringify(runner.chartResults).includes('referenceToken'), false);
});

Then('nested charts preserve their document identity in transient results', async () => {
  const nested = doc([file([1]), chart()], [edge('file', 'chart')], 'nested-charts');
  const reference = { id: 'nested', type: 'workflow', position: { x: 0, y: 0 }, data: { workflowId: nested.id, name: nested.name, description: '', snapshot: nested } };
  const runner = createWorkflowRunner(doc([reference]));
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.equal(runner.chartResults[0].workflowId, 'nested-charts');
});

Then('chart history describes configuration and size changes', () => {
  const before = doc([chart()]);
  const configured = doc([chart('chart', { kind: 'bar', title: 'Requests' })]);
  const resized = doc([chart('chart', { width: 800 })]);
  assert.match(describeWorkflowChange(before, configured), /Configure.*Chart/);
  assert.match(describeWorkflowChange(before, resized), /Resize.*Chart/);
});

Then('named chart series preserve their ports mappings and independent live windows', async () => {
  assert.deepEqual(chartKinds, ['line', 'bar', 'pie', 'area', 'scatter', 'sankey', 'table']);
  const data = { ...defaultChartData(), maxPoints: 2, series: [
    { id: 'cpu', name: 'CPU', xPath: '/time', yPath: '/cpu' },
    { id: 'memory', name: 'Memory', xPath: '/time', yPath: '/memory' }] };
  assert.deepEqual(chartInputs(data).map(item => item.id), ['cpu', 'memory']);
  assert.deepEqual(chartInputs({ ...data, kind: 'table' }).map(item => item.id), ['rows']);
  assert.deepEqual(chartInputs({ ...data, kind: 'sankey' }).map(item => item.id), ['nodes', 'links']);
  assert.throws(() => validateChartData({ ...data, series: [data.series[0], data.series[0]] }), /unique/);
  let snapshot;
  for (const sample of [{ time: 'a', cpu: 0, memory: 5 }, { time: 'b', cpu: null, memory: 6 }, { time: 'c', cpu: 4, memory: 7 }])
    for (const port of ['cpu', 'memory']) snapshot = updateChartSnapshot(snapshot, 'chart', 'charts', data, port, sample, true);
  assert.deepEqual(snapshot.series.find(item => item.id === 'cpu').points, [{ x: 'b', y: null }, { x: 'c', y: 4 }]);
  assert.deepEqual(snapshot.series.find(item => item.id === 'memory').points.map(item => item.y), [6, 7]);
  let numeric;
  for (const value of [3, 4, 5]) numeric = updateChartSnapshot(numeric, 'chart', 'charts', { ...defaultChartData(), maxPoints: 2 }, 'value', value, true);
  assert.deepEqual(numeric.series[0].points, [{ x: 2, y: 4 }, { x: 3, y: 5 }]);
  const target = chart('chart', data), source = file([{ time: 'a', cpu: 2, memory: 3 }]);
  const original = doc([source, target], [edge('file', 'chart', 'value', 'cpu'), edge('file', 'chart', 'value', 'memory')]);
  assert.equal(isValueConnection(edge('file', 'chart', 'value', 'removed-series'), source, target), false);
  const parsed = parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(original)));
  assert.deepEqual(parsed.nodes.find(node => node.type === 'chart').data.series, data.series);
  const runner = createWorkflowRunner(original);
  await runner.nextAsync();
  assert.equal(runner.chartResults[0].series.length, 2);
});

Then('table views infer or select columns and bound retained rows and cells', () => {
  const data = { ...defaultChartData(), kind: 'table', maxPoints: 2 };
  let snapshot = updateChartSnapshot(undefined, 'table', 'charts', data, 'rows', [{ cpu: 0, safe: '<img src=x>' }]);
  assert.deepEqual(snapshot.columns.map(item => item.label), ['cpu', 'safe']);
  assert.deepEqual(snapshot.rows, [['0', '<img src=x>']]);
  snapshot = updateChartSnapshot(snapshot, 'table', 'charts', data, 'rows', [{ cpu: 2, safe: null }, { cpu: 3, safe: 'x'.repeat(600) }], true);
  assert.equal(snapshot.rows.length, 2); assert.equal(snapshot.rows[0][1], ''); assert.equal(snapshot.rows[1][1].length, 500);
  const mapped = updateChartSnapshot(undefined, 'table', 'charts', { ...data, columns: [{ id: 'cpu', label: 'CPU', path: '/metrics/cpu' }] }, 'rows', [{ metrics: { cpu: 0 }, ignored: true }]);
  assert.deepEqual(mapped.columns, [{ id: 'cpu', label: 'CPU' }]); assert.deepEqual(mapped.rows, [['0']]);
});

Then('Sankey views reject missing nodes negative weights and cycles', () => {
  const data = { ...defaultChartData(), kind: 'sankey' };
  const nodes = updateChartSnapshot(undefined, 'sankey', 'charts', data, 'nodes', ['A', 'B', 'C']);
  const links = [{ source: 'A', target: 'B', value: 0 }, { source: 'B', target: 'C', value: 2 }];
  const result = updateChartSnapshot(nodes, 'sankey', 'charts', data, 'links', links);
  assert.equal(result.error, undefined); assert.equal(result.links[0].value, 0);
  const replacedNodes = updateChartSnapshot(result, 'sankey', 'charts', data, 'nodes', ['X', 'Y']);
  assert.match(replacedNodes.error, /refer to a connected node/);
  assert.equal(updateChartSnapshot(replacedNodes, 'sankey', 'charts', data, 'links', [{ source: 'X', target: 'Y', value: 1 }]).error, undefined);
  assert.match(updateChartSnapshot(nodes, 'sankey', 'charts', data, 'links', [{ source: 'A', target: 'missing', value: 1 }]).error, /refer to a connected node/);
  assert.match(updateChartSnapshot(nodes, 'sankey', 'charts', data, 'links', [...links, { source: 'C', target: 'A', value: 1 }]).error, /cycle/);
  assert.match(updateChartSnapshot(nodes, 'sankey', 'charts', data, 'links', [{ source: 'A', target: 'B', value: -1 }]).error, /nonnegative/);
});

async function withJsonStream(profile, secure, action) {
  const { extractOperations, updateCatalogs } = await import('./lib/catalog.ts');
  const { catalogs } = await import('./lib/catalog-registry.ts');
  const { createWorkflowRequestExecution } = await import('./lib/workflow-execution.ts');
  const { streamMediaType } = await import('./lib/workflow-response-stream.ts');
  const schema = { openapi: '3.1.0', info: { title: 'Monitoring', version: '1' }, servers: [{ url: 'https://monitoring.example.test' }],
    ...(secure ? { components: { securitySchemes: { Key: { type: 'http', scheme: 'bearer' } } }, security: [{ Key: [] }] } : {}),
    paths: { '/samples': { get: { operationId: 'samples', 'x-operations-response-stream': profile, parameters: [{ name: 'previous', in: 'query', schema: { type: 'number' } }], responses: { 200: { description: 'Sample', content: {
      'application/json': { schema: { type: 'object', properties: { time: { type: 'number' }, cpu: { type: 'number' } } } },
      [streamMediaType(profile)]: { schema: { type: 'object' } } } } } } } } };
  const previous = [...catalogs], operation = extractOperations(schema, 'monitoring-fixture')[0];
  updateCatalogs([...previous, { id: 'monitoring-fixture', name: 'Monitoring', file: 'monitoring.json', document: schema, groups: [], execution: { kind: 'http', origin: 'https://monitoring.example.test' } }]);
  try { return await action({ operation, schema, createWorkflowRequestExecution }); }
  finally { updateCatalogs(previous); }
}
function jsonStreamReply(profile, source, size = 1) {
  const bytes = new TextEncoder().encode(source); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset < bytes.length) { controller.enqueue(bytes.slice(offset, offset + size)); offset += size; } else controller.close();
  } }), { headers: { 'Content-Type': profile === 'sse-json' ? 'text/event-stream' : 'application/x-ndjson' } });
}
Then('a {string} stream delivers chart samples before closing', async profile => {
  await withJsonStream(profile, false, async ({ operation, createWorkflowRequestExecution }) => {
    const samples = [{ time: 0, cpu: 0 }, { time: 1, cpu: 4 }], seen = [];
    const source = profile === 'sse-json' ? ': heartbeat\r\n\r\n' + samples.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') : samples.map(value => JSON.stringify(value)).join('\n') + '\n';
    for (const size of [1, 7, 4096]) {
      seen.length = 0; let resolved = false;
      const promise = createWorkflowRequestExecution(async () => jsonStreamReply(profile, source, size)).execute(operation, {}, undefined, undefined, undefined,
        value => { assert.equal(resolved, false); seen.push(value.body); });
      const result = await promise; resolved = true;
      assert.deepEqual(seen, samples); assert.deepEqual(result.response.body, samples[1]);
      assert.equal(result.response.transportMediaType, profile === 'sse-json' ? 'text/event-stream' : 'application/x-ndjson');
    }
  });
});
Then('streamed values reach chart ports while normal workflow requests remain step driven', async () => {
  await withJsonStream('ndjson', false, async ({ operation, schema }) => {
    const { createOperationGraph } = await import('./lib/workflow-graph.ts');
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'api', schema);
    const output = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'cpu'));
    const handle = output.data.fields.find(field => field.label === 'cpu').id;
    let emit, finish, signal, requests = 0;
    const executor = { execute(_operation, _values, currentSignal, _context, _progress, onValue) {
      requests++; signal = currentSignal; emit = onValue;
      return new Promise(resolve => { finish = () => resolve({ request: { method: 'GET', path: '/samples', query: {} }, response: { status: 200, statusText: '', headers: {}, mediaType: 'application/json', body: { cpu: 99 } } }); });
    } };
    const runner = createWorkflowRunner(doc([...graph.nodes, chart()], [...graph.edges, edge(output.id, 'chart', handle)]), undefined, executor);
    await runner.nextAsync();
    const submitted = runner.submit({});
    emit({ body: { cpu: 1 }, status: 200 }); emit({ body: { cpu: 2 }, status: 200 });
    assert.deepEqual(runner.chartResults[0].series[0].points.map(item => item.y), [1, 2]);
    assert.equal(requests, 1); assert.equal(runner.done, false);
    const before = JSON.stringify(runner.chartResults);
    const started = await submitted; assert.equal(started.kind, 'stream');
    runner.stopStream(started.id); assert.equal(signal.aborted, true);
    emit({ body: { cpu: 3 }, status: 200 }); assert.equal(JSON.stringify(runner.chartResults), before);
    finish(); await vi.waitFor(() => assert.equal(runner.streams[0].state, 'stopped'));
    runner.end();
  });
});
Then('credential stream samples are checked before leaving the execution boundary', async () => {
  await withJsonStream('ndjson', true, async ({ operation }) => {
    const { approvedOperation } = await import('./lib/secrets/policy.ts');
    const { executeCredentialed } = await import('./lib/secrets/execution.ts');
    const descriptor = await approvedOperation(operation, 'https://monitoring.example.test');
    const secret = 'monitoring-canary-9e84', credential = { id: crypto.randomUUID(), label: 'Key', kind: 'secret', value: secret, grants: [] };
    const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: credential.id } }, seen = [];
    await assert.rejects(executeCredentialed(descriptor, {}, binding, [credential], { assertCurrent() {},
      fetchRequest: async () => jsonStreamReply('ndjson', JSON.stringify({ cpu: 2 }) + '\n' + JSON.stringify({ cpu: secret }) + '\n'),
      onValue: value => seen.push(value) }), error => error.code === 'REDACTED');
    assert.deepEqual(seen, [{ body: { cpu: 2 }, status: 200 }]);
    assert.equal(JSON.stringify(seen).includes(secret), false);
  });
});
Then('cancelling a JSON stream releases its reader and ends pending chart delivery', async () => {
  const { readJsonStream } = await import('./lib/workflow-json-stream.ts');
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"cpu":0}\n')); }, cancel() { cancelled = true; } }));
  const seen = [];
  const reading = readJsonStream(response, false, controller.signal, undefined, value => { seen.push(value); controller.abort(); });
  await assert.rejects(reading, error => error.code === 'CANCELLED');
  assert.equal(cancelled, true); assert.equal(response.body.locked, false); assert.equal(seen.length, 1);
});

Then('chart input errors remain visible until their own input recovers', () => {
  const data = { ...defaultChartData(), series: [{ id: 'cpu', name: 'CPU', xPath: '', yPath: '' }, { id: 'memory', name: 'Memory', xPath: '', yPath: '' }] };
  const bad = updateChartSnapshot(undefined, 'chart', 'charts', data, 'cpu', 'invalid', true);
  const other = updateChartSnapshot(bad, 'chart', 'charts', data, 'memory', 4, true);
  assert.match(other.error, /CPU:.*finite numbers/);
  assert.equal(updateChartSnapshot(other, 'chart', 'charts', data, 'cpu', 0, true).error, undefined);
});

Then('chart presentation blends theme tones and keeps named identities across ordering', () => {
  const tones = ['#eee9df', '#dedad1', '#ffb162', '#a35139', '#2c3b4d', '#1b2632'];
  const palette = chartPalette({ getPropertyValue: key => tones[Number(key.slice(-1)) - 1] ?? '' });
  const cpu = chartIdentityStyle('CPU', palette), memory = chartIdentityStyle('Memory', palette);
  assert.notEqual(cpu.color, memory.color);
  const single = { ...defaultChartData(), title: 'CPU' };
  assert.equal(chartSeriesName(single, single.series[0]), 'CPU');
  assert.equal(chartSeriesName({ ...single, series: [...single.series, { id: 'memory', name: 'Memory' }] }, single.series[0]), 'Series 1');
  assert.deepEqual(cpu, chartIdentityStyle(' cpu ', palette));
  const forward = new Map(['CPU', 'Memory', 'Source', 'Sample 1'].map(name => [name, chartIdentityStyle(name, palette)]));
  for (const name of [...forward.keys()].reverse()) assert.deepEqual(forward.get(name), chartIdentityStyle(name, palette));
  for (const name of Array.from({ length: 24 }, (_, index) => `Category ${index}`)) {
    const visual = chartIdentityStyle(name, palette);
    const rgb = value => value.startsWith('#') ? value.slice(1).match(/../g).map(channel => parseInt(channel, 16)) : value.match(/[\d.]+/g).map(Number);
    const actual = rgb(visual.color);
    assert.ok(palette.colors.some(a => palette.colors.some(b => {
      const start = rgb(a), end = rgb(b), axis = start.reduce((best, value, index) => Math.abs(value - end[index]) > Math.abs(start[best] - end[best]) ? index : best, 0);
      if (Math.abs(start[axis] - end[axis]) <= 1) return actual.every((value, index) => Math.abs(value - start[index]) <= 1);
      const weight = (actual[axis] - start[axis]) / (end[axis] - start[axis]);
      return weight >= 0 && weight <= 1 && actual.every((value, index) => Math.abs(value - (start[index] + weight * (end[index] - start[index]))) <= 1.1);
    })), `Expected a blend of authored tones: ${visual.color}`);
    assert.ok(tones.includes(visual.textColor)); assert.ok(tones.includes(visual.decal.color));
    assert.ok(visual.symbol); assert.ok(visual.dash);
  }
  const dark = chartPalette({ getPropertyValue: key => [...tones].reverse()[Number(key.slice(-1)) - 1] ?? '' });
  assert.notEqual(chartIdentityStyle('CPU', dark).color, cpu.color);
  assert.throws(() => chartPalette({ getPropertyValue: () => '' }), /six color tones/);
  for (const names of [Array.from({ length: 12 }, (_, index) => `Sample ${index + 1}`), expandedExample.nodes.find(node => node.id === 'dense-slices').data.file.value.map(slice => slice.service)]) {
    const styles = chartNamedStyles(names, palette), reversed = chartNamedStyles([...names].reverse(), palette);
    assert.equal(new Set([...styles.values()].map(style => style.color)).size, names.length);
    for (const name of names) assert.deepEqual(styles.get(name), reversed.get(name));
  }
});

Then('the expanded chart example preserves small views and executes larger datasets', () => {
  assert.deepEqual(expandedExample.nodes.slice(0, smallExample.nodes.length), smallExample.nodes);
  assert.deepEqual(expandedExample.edges.slice(0, smallExample.edges.length), smallExample.edges);
  const document = parseWorkflowDocument(JSON.stringify(expandedExample));
  for (const node of document.nodes.filter(node => node.type === 'file')) assert.deepEqual(JSON.parse(node.data.file.source), node.data.file.value);
  const runner = createWorkflowRunner(document);
  try {
    assert.equal(runner.next().kind, 'complete');
    assert.equal(runner.chartResults.length, 14);
    for (const result of runner.chartResults) assert.equal(result.error, undefined, result.nodeId);
    for (const kind of ['line', 'area', 'scatter']) {
      const result = runner.chartResults.find(view => view.nodeId === 'dense-' + kind);
      assert.equal(result.series.length, 6); assert.ok(result.series.every(series => series.points.length === 1000));
    }
    assert.equal(runner.chartResults.find(view => view.nodeId === 'dense-bar').series[0].points.length, 24);
    assert.equal(runner.chartResults.find(view => view.nodeId === 'dense-pie').series[0].points.length, 24);
    assert.equal(runner.chartResults.find(view => view.nodeId === 'dense-table').rows.length, 1000);
    const sankey = runner.chartResults.find(view => view.nodeId === 'dense-sankey');
    assert.equal(sankey.nodes.length, 23); assert.equal(sankey.links.length, 60);
    for (const node of sankey.nodes) {
      const incoming = sankey.links.filter(link => link.target === node.name).reduce((total, link) => total + link.value, 0);
      const outgoing = sankey.links.filter(link => link.source === node.name).reduce((total, link) => total + link.value, 0);
      if (incoming && outgoing) assert.equal(incoming, outgoing, node.name);
    }
  } finally { runner.end(); }
});

async function streamRunFixture(count, action) {
  return withJsonStream('ndjson', false, async ({ operation, schema }) => {
    const { createOperationGraph } = await import('./lib/workflow-graph.ts');
    const nodes = [], edges = [];
    for (let index = 0; index < count; index++) {
      const id = `api-${index}`, graph = createOperationGraph(operation, { x: index * 400, y: 0 }, id, schema);
      nodes.push(...graph.nodes, chart(`view-${index}`)); edges.push(...graph.edges);
      const output = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'cpu'));
      edges.push(edge(output.id, `view-${index}`, output.data.fields.find(field => field.label === 'cpu').id));
      if (index) {
        const previous = nodes.find(node => node.type === 'data' && node.data.ownerId === `api-${index - 1}` && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'cpu'));
        const input = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs' && node.data.fields.some(field => field.label === 'previous'));
        edges.push(edge(previous.id, input.id, previous.data.fields.find(field => field.label === 'cpu').id, input.data.fields.find(field => field.label === 'previous').id));
      }
    }
    const requests = [];
    const executor = { execute(_operation, _values, signal, _binding, _progress, sample) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { signal, sample, finish(body = { cpu: 99 }) { resolve({ request: { method: 'GET', path: '/samples', query: {} }, response: { status: 200, statusText: '', headers: {}, mediaType: 'application/json', body } }); }, fail: reject };
      signal.addEventListener('abort', () => reject(new Error('The request was cancelled.')), { once: true });
      requests.push(request); return promise;
    } };
    const document = doc(nodes, edges), before = JSON.stringify(document), runner = createWorkflowRunner(document, undefined, executor);
    try { await action({ runner, requests, document, before }); }
    finally { runner.end(); }
    assert.equal(JSON.stringify(document), before);
  });
}
Then('a live stream continues updating after later operations and workflow steps finish', async () => {
  await streamRunFixture(2, async ({ runner, requests }) => {
    assert.equal((await runner.nextAsync()).nodeId, 'api-0');
    const submitting = runner.submit({ ...runner.next().values }); requests[0].sample({ body: { cpu: 1 }, status: 200 });
    const first = await submitting; assert.equal(first.kind, 'stream'); assert.equal(runner.streams[0].state, 'running');
    assert.equal((await runner.nextAsync()).nodeId, 'api-1');
    const second = runner.submit({ ...runner.next().values }); requests[1].finish({ cpu: 7 });
    assert.equal((await second).response.body.cpu, 7);
    assert.equal((await runner.nextAsync()).kind, 'complete'); assert.equal(runner.done, false);
    requests[0].sample({ body: { cpu: 2 }, status: 200 });
    assert.deepEqual(runner.chartResults.find(result => result.nodeId === 'view-0').series[0].points.map(point => point.y), [1, 2]);
    assert.equal(requests.length, 2);
    runner.stopStream(first.id);
    await vi.waitFor(() => assert.equal(runner.done, true));
  });
});
Then('stopping one stream leaves another stream running and Quit cancels all', async () => {
  await streamRunFixture(2, async ({ runner, requests }) => {
    await runner.nextAsync(); const firstPromise = runner.submit({ ...runner.next().values }); requests[0].sample({ body: { cpu: 1 }, status: 200 }); const first = await firstPromise;
    await runner.nextAsync(); const secondPromise = runner.submit({ ...runner.next().values }); requests[1].sample({ body: { cpu: 2 }, status: 200 }); const second = await secondPromise;
    assert.equal(runner.streams.filter(stream => stream.state === 'running').length, 2);
    runner.stopStream(first.id); assert.equal(requests[0].signal.aborted, true); assert.equal(requests[1].signal.aborted, false);
    requests[1].sample({ body: { cpu: 3 }, status: 200 });
    assert.deepEqual(runner.chartResults.find(result => result.nodeId === 'view-1').series[0].points.map(point => point.y), [2, 3]);
    assert.equal(runner.streams.find(stream => stream.id === second.id).state, 'running');
    runner.end(); assert.equal(requests[1].signal.aborted, true);
  });
});
Then('a completed background stream preserves the foreground request controller', async () => {
  await streamRunFixture(2, async ({ runner, requests }) => {
    await runner.nextAsync(); const firstPromise = runner.submit({ ...runner.next().values }); requests[0].sample({ body: { cpu: 1 }, status: 200 }); await firstPromise;
    await runner.nextAsync(); const secondPromise = runner.submit({ ...runner.next().values });
    const rejection = assert.rejects(secondPromise, /cancelled/);
    requests[0].finish(); await vi.waitFor(() => assert.equal(runner.streams[0].state, 'complete'));
    runner.cancelPending(); assert.equal(requests[1].signal.aborted, true); await rejection;
  });
});
Then('a stream failure after promotion leaves the next form usable', async () => {
  await streamRunFixture(2, async ({ runner, requests }) => {
    await runner.nextAsync(); const started = runner.submit({ ...runner.next().values }); requests[0].sample({ body: { cpu: 1 }, status: 200 }); await started;
    const next = await runner.nextAsync(); requests[0].fail(new Error('Fixture stream failed.'));
    await vi.waitFor(() => assert.equal(runner.streams[0].state, 'error'));
    assert.match(runner.streams[0].error, /Fixture stream failed/); assert.equal((await runner.nextAsync()).id, next.id);
    const submitted = runner.submit({ ...runner.next().values }); requests[1].finish(); await submitted;
    assert.equal(requests.length, 2);
  });
});

Then('a completed stream cannot change its views through a stale callback', async () => {
  await streamRunFixture(1, async ({ runner, requests }) => {
    await runner.nextAsync(); const submitted = runner.submit({ ...runner.next().values });
    requests[0].sample({ body: { cpu: 1 }, status: 200 }); await submitted;
    requests[0].finish(); await vi.waitFor(() => assert.equal(runner.streams[0].state, 'complete'));
    const before = JSON.stringify(runner.chartResults);
    requests[0].sample({ body: { cpu: 999 }, status: 200 }); assert.equal(JSON.stringify(runner.chartResults), before);
  });
});
Then('stream connection failure keeps the original form ready without an automatic retry', async () => {
  await streamRunFixture(1, async ({ runner, requests }) => {
    const original = await runner.nextAsync(), submitted = runner.submit({ ...original.values });
    const rejected = assert.rejects(submitted, /Fixture connection failed/);
    requests[0].fail(new Error('Fixture connection failed.')); await rejected;
    assert.equal((await runner.nextAsync()).id, original.id); assert.equal(requests.length, 1);
    const retried = runner.submit({ ...original.values }); requests[1].finish({ cpu: 9 });
    assert.equal((await retried).response.body.cpu, 9); assert.equal(requests.length, 2);
  });
});
