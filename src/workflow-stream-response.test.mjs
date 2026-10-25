// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { inspectResponseContent, readWorkflowResponseBody, responseFileName } from './lib/workflow-response-body.ts';
import { isResponseProgress, readResponseStream, responseAccept, responseStreamProfile, streamLimits, streamMediaType } from './lib/workflow-response-stream.ts';
import { createOperationGraph, isWorkflowConnection } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, httpResponseStreaming } from './lib/schema-patches.ts';

const origin = 'https://stream.example.test', canary = 'private-stream-canary-5192', encoder = new TextEncoder();
const finalResponse = text => ({ id: 'resp_fixture', object: 'response', status: 'completed', error: null,
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const jsonSchema = { type: 'object', properties: { id: { type: 'string' } } };
function document(profile, mode = 'public') {
  return { openapi: '3.1.0', info: { title: 'Stream fixtures', version: '1' }, servers: [{ url: origin }],
    ...(mode === 'private' ? { components: { securitySchemes: { Key: { type: 'http', scheme: 'bearer' } } }, security: [{ Key: [] }] } : {}),
    paths: { '/stream': { post: { operationId: 'stream', 'x-operations-response-stream': profile,
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { stream: { type: 'boolean' } } } } } },
      responses: { 200: { description: 'Final JSON or stream', content: { 'application/json': { schema: jsonSchema }, [streamMediaType(profile)]: { schema: { type: 'object' } } } } } } },
      '/accept': { post: { operationId: 'accept', requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } }, responses: { 200: { description: 'Accepted' } } } } } };
}
function sse(value, ending = '\r\n', multiline = false) {
  let data = JSON.stringify(value);
  if (multiline) data = data.replace(',"response":', ',\n"response":');
  return 'event: '+value.type+ending+data.split('\n').map(line => 'data: '+line+ending).join('')+ending;
}
function wire(profile, text = 'Hello Ω 🌿!') {
  if (profile === 'openai-responses') return '\uFEFF: keepalive\r\nid: ignored\r\nretry: 1\r\n\r\n'
    +sse({ type: 'response.created', sequence_number: 0, response: { id: 'resp_fixture' } }, '\r')
    +sse({ type: 'response.output_text.delta', sequence_number: 1, delta: 'not a final value' }, '\n')
    +sse({ type: 'response.completed', sequence_number: 2, response: finalResponse(text) }, '\r\n', true);
  const pieces = [text.slice(0, 6), text.slice(6, -1), text.slice(-1)];
  return pieces.map((part, index) => JSON.stringify({ model: 'fixture', done: index === 2,
    ...(index === 2 ? { done_reason: 'stop', eval_count: 3 } : {}),
    ...(profile === 'ollama-chat' ? { message: { role: 'assistant', content: part, thinking: index === 0 ? 'think ' : index === 1 ? 'carefully' : '',
      ...(index === 1 ? { tool_calls: [{ function: { name: 'lookup', arguments: { q: 'Ω' } } }] } : {}) } }
      : { response: part, thinking: index === 0 ? 'think ' : index === 1 ? 'carefully' : '' }) })+'\r\n').join('');
}
function reply(profile, source, size = 4096, close = false, onCancel = () => {}) {
  const bytes = typeof source === 'string' ? encoder.encode(source) : source;
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset < bytes.length) { controller.enqueue(bytes.slice(offset, offset + size)); offset += size; }
    else if (close) controller.close();
  }, cancel: onCancel }), { headers: { 'Content-Type': streamMediaType(profile) } });
}
async function fixture(mode, profile, action) {
  const doc = document(profile, mode), models = extractOperations(doc, 'streams'), op = models[0];
  assert.equal(inspectServiceSchema(doc, 'streams').operations[0].responseStream, profile);
  const previous = [...catalogs];
  updateCatalogs([...previous, { id: 'streams', name: 'Streams', file: 'streams.json', document: doc, groups: [], execution: { kind: 'http', origin } }]);
  const descriptor = await approvedOperation(op, origin), credential = { id: crypto.randomUUID(), label: 'Key', kind: 'secret', value: canary, grants: [] };
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: credential.id } };
  const execute = (fetchRequest, signal, onProgress, values = { 'body:stream': 'true' }) => mode === 'private'
    ? executeCredentialed(descriptor, values, binding, [credential], { assertCurrent() {}, fetchRequest,
      ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) })
    : createWorkflowRequestExecution(fetchRequest).execute(op, values, signal, undefined, onProgress);
  try { return await action({ execute, op, doc, models }); }
  finally { updateCatalogs(previous); }
}

Then('{string} {string} streaming preserves the terminal value across chunk boundaries', async (mode, profile) => {
  await fixture(mode, profile, async ({ execute }) => {
    let expected;
    for (const size of [1, 2, 7, 4096]) {
      const progress = []; let calls = 0, cancelled = false, sent;
      const result = await execute(async (_url, init) => { calls++; sent = init; return reply(profile, wire(profile), size, false, () => { cancelled = true; }); },
        undefined, value => progress.push(value));
      assert.equal(calls, 1); assert.equal(cancelled, true);
      assert.equal(new Headers(sent.headers).get('Accept'), streamMediaType(profile));
      assert.equal(result.response.mediaType, 'application/json'); assert.equal(result.response.transportMediaType, streamMediaType(profile));
      assert.equal(result.response.stream.events, 3); assert.ok(progress.every(isResponseProgress));
      assert.ok(progress.length <= 3, 'Fast streams do not emit an unbounded UI update per frame/chunk.');
      expected ??= result.response.body; assert.deepEqual(result.response.body, expected);
    }
    if (profile === 'openai-responses') assert.deepEqual(expected, finalResponse('Hello Ω 🌿!'));
    else if (profile === 'ollama-chat') {
      assert.equal(expected.message.content, 'Hello Ω 🌿!'); assert.equal(expected.message.thinking, 'think carefully');
      assert.deepEqual(expected.message.tool_calls, [{ function: { name: 'lookup', arguments: { q: 'Ω' } } }]);
    } else { assert.equal(expected.response, 'Hello Ω 🌿!'); assert.equal(expected.thinking, 'think carefully'); }
    const ordinary = await execute(async () => Response.json({ id: 'ordinary' }), undefined, undefined, { 'body:stream': 'false' });
    assert.deepEqual(ordinary.response.body, { id: 'ordinary' }); assert.equal(ordinary.response.stream, undefined);
  });
});

Then('{string} SSE terminal line endings are complete without a following byte', async mode => {
  await fixture(mode, 'openai-responses', async ({ execute }) => {
    for (const ending of ['\r', '\n', '\r\n']) {
      const result = await execute(async () => reply('openai-responses',
        sse({ type: 'response.completed', response: finalResponse('terminal') }, ending), 1, true));
      assert.deepEqual(result.response.body, finalResponse('terminal'));
    }
  });
});

Then('{string} streams reject invalid incomplete oversized and aborted outcomes without replay', async mode => {
  await fixture(mode, 'openai-responses', async ({ execute }) => {
    const deep = '['.repeat(66)+'0'+']'.repeat(66);
    const cases = [
      ['malformed JSON', 'data: not JSON\n\n'], ['provider failure', sse({ type: 'response.failed', response: { error: { message: canary } } })],
      ['incomplete result', sse({ type: 'response.incomplete', response: { status: 'incomplete' } })],
      ['missing terminal event', sse({ type: 'response.output_text.delta', delta: canary }), true],
      ['missing frame delimiter', 'data: '+JSON.stringify({ type: 'response.completed', response: finalResponse('x') })+'\n', true],
      ['invalid UTF-8', Uint8Array.of(0xff)], ['frame limit', 'data: '+'x'.repeat(streamLimits.frameCharacters + 1)],
      ['byte limit', new Uint8Array(streamLimits.bytes + 1)],
      ['depth limit', 'data: {"type":"response.output_text.delta","delta":'+deep+'}\n\n'],
      ['event limit', 'data: {"type":"response.output_text.delta","delta":"x"}\n\n'.repeat(streamLimits.events + 1)],
      ['identity change', sse({ type: 'response.created', response: { id: 'first' } })+sse({ type: 'response.completed', response: finalResponse('x') })],
      ['sequence rewind', sse({ type: 'response.output_text.delta', sequence_number: 2 })+sse({ type: 'response.completed', sequence_number: 1, response: finalResponse('x') })],
      ['unsuccessful terminal', sse({ type: 'response.completed', response: { ...finalResponse('x'), status: 'failed' } })],
    ];
    for (const [name, source, close] of cases) {
      let calls = 0;
      await assert.rejects(() => execute(async () => { calls++; return reply('openai-responses', source, Math.max(source.length, 1), close); }),
        error => !JSON.stringify(error).includes(canary) && (!('response' in error) || error.response.body === null), name);
      assert.equal(calls, 1, name);
    }
    const controller = new AbortController(); let calls = 0, cancelled = false;
    const promise = execute(async () => { calls++; return reply('openai-responses', '', 1, false, () => { cancelled = true; }); }, controller.signal,
      () => controller.abort());
    await assert.rejects(() => promise); assert.equal(calls, 1); assert.equal(cancelled, true);
  });
  await fixture(mode, 'ollama-generate', async ({ execute }) => {
    for (const source of ['{"model":"fixture","response":"partial","done":false}\n', '{"error":"'+canary+'"}\n',
      '{"model":"fixture","done":true}', '{"model":"fixture","done":"true"}\n', '{"model":"fixture","done":true}\r{"done":false}\n'])
      await assert.rejects(() => execute(async () => reply('ollama-generate', source, 4096, true)));
  });
});

Then('{string} HTTP streams have bounded deadlines that do not extend on progress', async mode => {
  await fixture(mode, 'openai-responses', async ({ execute }) => {
    for (const deadline of ['connect', 'idle', 'run']) {
      vi.useFakeTimers();
      try {
        let started; const ready = new Promise(resolve => { started = resolve; });
        let calls = 0, interval, cancelled = false;
        const promise = execute(async (_url, init) => {
          calls++;
          if (deadline === 'connect') { started(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true })); }
          return new Response(new ReadableStream({ start(controller) {
            if (deadline === 'run') interval = setInterval(() => controller.enqueue(encoder.encode(': alive\n\n')), 1000);
          }, cancel() { cancelled = true; clearInterval(interval); } }), { headers: { 'Content-Type': 'text/event-stream' } });
        }, undefined, () => started());
        const outcome = promise.then(value => ({ value }), error => ({ error }));
        await ready;
        await vi.advanceTimersByTimeAsync(deadline === 'run' ? streamLimits.runMs + 1 : 15_001);
        const result = await outcome;
        assert.ok(result.error, deadline); assert.equal(calls, 1);
        if (deadline !== 'connect') assert.match(result.error.message, deadline === 'idle' ? /stopped sending data/ : /timed out|run deadline/);
        if (deadline !== 'connect') assert.equal(cancelled, true);
      } finally { vi.useRealTimers(); }
    }
  });
});

Then('streaming workflow routing waits for completion and sends one terminal JSON value downstream', async () => {
  await fixture('public', 'openai-responses', async ({ doc, models }) => {
    const first = createOperationGraph(models[0], { x: 0, y: 0 }, 'stream', doc), second = createOperationGraph(models[1], { x: 700, y: 0 }, 'accept', doc);
    assert.ok(!first.nodes.some(node => node.id.includes('text%2Fevent-stream')));
    const output = first.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'id'));
    const input = second.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs' && node.data.fields.some(field => field.label === 'id'));
    assert.ok(output && input);
    const edge = { id: 'terminal-id', source: output.id, sourceHandle: output.data.fields.find(field => field.label === 'id').id,
      target: input.id, targetHandle: input.data.fields.find(field => field.label === 'id').id, kind: 'mapping' };
    const nodes = [...first.nodes, ...second.nodes], edges = [...first.edges, ...second.edges];
    assert.equal(isWorkflowConnection(edge, nodes, edges), true);
    edges.push(edge);
    const graph = { version: 3, id: 'stream-routing', name: 'Stream routing', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
    let calls = 0;
    const runner = createWorkflowRunner(graph, 'stream', createWorkflowRequestExecution(async (url, init) => {
      calls++;
      if (String(url).endsWith('/stream')) return reply('openai-responses', wire('openai-responses'), 2);
      assert.deepEqual(JSON.parse(init.body), { id: 'resp_fixture' }); return Response.json({ accepted: true });
    }));
    assert.equal(runner.next().kind, 'operation');
    await runner.submit({ 'body:stream': 'true' }, undefined, progress => { if (!progress.events) assert.equal(calls, 1); });
    assert.equal(calls, 1); const next = runner.next(); assert.equal(next.kind, 'operation'); assert.equal(next.values['body:id'], 'resp_fixture');
    await runner.submit(next.values); assert.equal(calls, 2);
  });
});

Then('private stream progress contains counts only and the assembled result is scrubbed before routing', async () => {
  for (const profile of ['openai-responses', 'ollama-chat', 'ollama-generate']) await fixture('private', profile, async ({ execute }) => {
    const progress = [], text = 'safe '+canary+' tail';
    const result = await execute(async () => reply(profile, wire(profile, text), 1), undefined, value => progress.push(value));
    assert.equal(result.response.redacted, true); assert.ok(!JSON.stringify(result).includes(canary));
    assert.ok(progress.every(isResponseProgress)); assert.ok(progress.every(value => Object.keys(value).sort().join(',') === 'bytes,events'));
    assert.ok(!JSON.stringify(progress).includes('safe')); assert.ok(!JSON.stringify(progress).includes(canary));
  });
  for (const invalid of [{ bytes: -1, events: 1 }, { bytes: 0, events: 10_001 }, { bytes: 0, events: 0, text: canary },
    { bytes: '0', events: 0 }, { bytes: 0, events: Infinity }]) assert.equal(isResponseProgress(invalid), false);
});

Then('pinned OpenAI and Ollama operations select reviewed stream profiles while unrelated streams stay unavailable', async () => {
  for (const [id, names] of [['openai', { createResponse: 'openai-responses' }], ['ollama', { chat: 'ollama-chat', generate: 'ollama-generate' }]]) {
    const source = serviceSchemaDescriptors.find(item => item.id === id), raw = await readServiceSchemaUpstream(id), doc = await readServiceSchema(id);
    assert.deepEqual(source.patches, [httpResponseStreaming]);
    assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), source.sha256);
    assert.deepEqual(applySchemaPatches(doc, [httpResponseStreaming]), doc);
    const inspected = inspectServiceSchema(doc, id);
    for (const [name, profile] of Object.entries(names)) {
      const op = inspected.operations.find(op => op.id === id+':'+name);
      assert.equal(op.unavailableReason, undefined); assert.equal(op.responseStream, profile);
      assert.equal(op.responseContent['200'][streamMediaType(profile)], 'stream');
      const result = await readWorkflowResponseBody(reply(profile, wire(profile), 7), op, 'POST', new AbortController().signal);
      assert.equal(result.mediaType, 'application/json'); assert.equal(result.transportMediaType, streamMediaType(profile));
    }
    assert.equal(inspected.operations.filter(op => op.responseStream).length, Object.keys(names).length);
    const changed = structuredClone(raw); changed.servers[0].url = 'https://unreviewed.example.test';
    assert.throws(() => applySchemaPatches(changed, [httpResponseStreaming]), /reviewed/);
  }
  const unreviewed = document('openai-responses'); delete unreviewed.paths['/stream'].post['x-operations-response-stream'];
  const op = extractOperations(unreviewed, 'unreviewed')[0];
  await assert.rejects(() => readWorkflowResponseBody(reply('openai-responses', wire('openai-responses')), op, 'POST', new AbortController().signal));
});

Then('stream readers reject malformed identities envelopes and provider payloads before publishing a value', async () => {
  const event = value => sse(value, '\n');
  const cases = [
    ['openai-responses', 'data: true\n\n', 'FRAME'],
    ['openai-responses', 'data: {"type":"response.created","value":1e400}\n\n', 'FRAME'],
    ['openai-responses', 'data: {"delta":"'+canary+'"}\n\n', 'FRAME'],
    ['openai-responses', 'event: response.completed\ndata: {"type":"response.created"}\n\n', 'FRAME'],
    ['openai-responses', event({ type: 'response.created', sequence_number: 0.5 }), 'FRAME'],
    ...[1, ''].map(response_id => ['openai-responses', event({ type: 'response.created', response_id }), 'FRAME']),
    ['openai-responses', event({ type: 'response.created', response_id: 'first' })+event({ type: 'response.created', response_id: 'other' }), 'FRAME'],
    ['openai-responses', event({ type: 'response.completed', response: { id: 'resp_fixture', status: 'completed' } }), 'FRAME'],
    ['openai-responses', event({ type: 'response.completed', response: { ...finalResponse('safe'), error: { message: canary } } }), 'PROVIDER'],
    ['openai-responses', 'event: '+'x'.repeat(257)+'\n', 'LIMIT'],
    ['openai-responses', ':'+'x'.repeat(streamLimits.frameCharacters)+'\n', 'LIMIT'],
    ['openai-responses', ('data: '+'x'.repeat(streamLimits.frameCharacters / 2)+'\n').repeat(2)+'\n', 'LIMIT'],
    ['openai-responses', Uint8Array.of(0xe2, 0x82), 'FRAME'],
    ['openai-responses', 'data: '+JSON.stringify({ type: 'response.completed', response: finalResponse('safe') })+'\r', 'INCOMPLETE'],
    ['openai-responses', event({ type: 'response.created', values: Array(streamLimits.nodes).fill(0) }), 'LIMIT'],
    ...[[], { content: 1 }, { thinking: true }, { images: [canary] }, { role: 'user' },
      { tool_calls: {} }, { tool_calls: [null] }].map(message => ['ollama-chat', JSON.stringify({ model: 'fixture', done: true, message })+'\n', 'FRAME']),
    ...['', 42].map(model => ['ollama-chat', JSON.stringify({ model, done: true })+'\n', 'FRAME']),
    ['ollama-chat', '{"model":"first","done":false}\n{"model":"other","done":true}\n', 'FRAME'],
    ['ollama-chat', '{"done":true}\n', 'FRAME'],
  ];
  for (const [profile, source, code] of cases) {
    const progress = [];
    await assert.rejects(() => readResponseStream(reply(profile, source, 2 ** 20, true), profile, new AbortController().signal, value => progress.push(value)),
      error => error.code === code && !JSON.stringify(error).includes(canary), profile+': '+String(source).slice(0, 80));
    assert.ok(progress.every(isResponseProgress));
  }
});

Then('stream negotiation and optional provider fields retain one complete terminal representation', async () => {
  assert.throws(() => responseStreamProfile('unsupported'), /streaming profile is not supported/);
  for (const [profile, fallback, body, expected] of [
    ['openai-responses', undefined, undefined, 'application/json'], ['openai-responses', 'text/plain', null, 'text/plain'],
    ['openai-responses', undefined, { stream: true }, 'text/event-stream'],
    ['ollama-chat', 'application/json', null, 'application/x-ndjson'],
    ['ollama-generate', 'application/json', { stream: false }, 'application/json'],
    [undefined, 'text/plain', { stream: true }, 'text/plain'],
  ]) assert.equal(responseAccept(profile, fallback, body), expected);
  const source = '\uFEFF: alive\nignored\nid\nretry: 0\nevent: message\ndata: '
    +JSON.stringify({ type: 'response.created', response_id: 'resp_fixture' })+'\n\n'
    +sse({ type: 'response.completed', response_id: 'resp_fixture', response: finalResponse('safe') }, '\n');
  assert.deepEqual((await readResponseStream(reply('openai-responses', source, 7), 'openai-responses', new AbortController().signal)).body, finalResponse('safe'));
  for (const profile of ['ollama-chat', 'ollama-generate']) {
    const result = await readResponseStream(reply(profile, '\n{"model":"fixture","done":false}\n{"done":true}\n', 7), profile, new AbortController().signal);
    assert.deepEqual(result.body, profile === 'ollama-chat' ? { model: 'fixture', done: true, message: { role: 'assistant', content: '' } }
      : { model: 'fixture', done: true, response: '' });
  }
  for (const value of [null, [], { bytes: 0, events: 0, extra: true }]) assert.equal(isResponseProgress(value), false);
});

Then('stream readers cancel early aborted raced and fragmented responses within their resource budget', async () => {
  let cancelled = 0;
  const aborted = reply('openai-responses', '', 1, false, () => { cancelled++; return Promise.reject(new Error(canary)); });
  await assert.rejects(() => readResponseStream(aborted, 'openai-responses', AbortSignal.abort()), error => error.code === 'CANCELLED');
  assert.equal(cancelled, 1);
  await assert.rejects(() => readResponseStream(new Response(null), 'openai-responses', new AbortController().signal), error => error.code === 'INCOMPLETE');
  const controller = new AbortController();
  const raced = new Response(new ReadableStream({ pull(stream) {
    stream.enqueue(encoder.encode(sse({ type: 'response.completed', response: finalResponse('too late') }, '\n')));
    queueMicrotask(() => controller.abort());
  }, cancel() { cancelled++; } }));
  await assert.rejects(() => readResponseStream(raced, 'openai-responses', controller.signal), error => error.code === 'CANCELLED');
  const waiting = new AbortController();
  await assert.rejects(() => readResponseStream(new Response(new ReadableStream({ cancel() { cancelled++; } })),
    'openai-responses', waiting.signal, () => waiting.abort()), error => error.code === 'CANCELLED');
  for (const fragment of [new Uint8Array(), encoder.encode(':\n')]) {
    let pulls = 0, stopped = false;
    const response = new Response(new ReadableStream({ pull(stream) { pulls++; stream.enqueue(fragment); },
      cancel() { stopped = true; return Promise.reject(new Error(canary)); } }));
    await assert.rejects(() => readResponseStream(response, 'openai-responses', new AbortController().signal), error => error.code === 'LIMIT');
    assert.equal(stopped, true);
    assert.ok(pulls <= (fragment.length ? streamLimits.chunks : 1024) + 2);
  }
  const terminal = encoder.encode(sse({ type: 'response.completed', response: finalResponse('after empty chunk') }, '\n'));
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array()); stream.enqueue(terminal); } }));
  assert.deepEqual((await readResponseStream(response, 'openai-responses', new AbortController().signal)).body, finalResponse('after empty chunk'));
});

Then('the standalone stream reader enforces idle and total deadlines while cleaning up its producer', async () => {
  for (const deadline of ['IDLE', 'TIMEOUT']) {
    vi.useFakeTimers();
    let interval, cancelled = false;
    try {
      const response = new Response(new ReadableStream({ start(stream) {
        if (deadline === 'TIMEOUT') interval = setInterval(() => stream.enqueue(encoder.encode(': alive\n\n')), 1000);
      }, cancel() { cancelled = true; clearInterval(interval); } }));
      const outcome = readResponseStream(response, 'openai-responses', new AbortController().signal).then(value => ({ value }), error => ({ error }));
      await vi.advanceTimersByTimeAsync((deadline === 'IDLE' ? streamLimits.idleMs : streamLimits.runMs) + 1);
      assert.equal((await outcome).error?.code, deadline);
      assert.equal(cancelled, true);
    } finally { clearInterval(interval); vi.useRealTimers(); }
  }
});

Then('response declarations and body cancellation preserve fail closed media and empty body behavior', async () => {
  const binary = { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
  assert.equal(inspectResponseContent({ invalid: {} }, {}), undefined);
  for (const ref of [42, 'https://unreviewed.example.test/schema', '#/bad~3name', '#/missing', '#/loop']) {
    const content = inspectResponseContent({ 200: binary, 201: { $ref: ref } }, { loop: { $ref: '#/loop' } });
    assert.equal(content['200']['application/octet-stream'], 'binary');
    assert.deepEqual(Object.keys(content['201']), []);
  }
  assert.throws(() => inspectResponseContent({ 200: { content: { 'text/event-stream': {} } } }, {}, 'openai-responses'), /final JSON/);
  const operation = extractOperations(document('openai-responses'), 'stream-body')[0];
  assert.deepEqual(await readWorkflowResponseBody(new Response(null), operation, 'OPTIONS', new AbortController().signal),
    { body: null, mediaType: 'application/json' });
  let cancelled = 0;
  const response = media => new Response(new ReadableStream({ cancel() { cancelled++; return Promise.reject(new Error(canary)); } }),
    { headers: { 'Content-Type': media } });
  assert.deepEqual(await readWorkflowResponseBody(response('application/json'), operation, 'HEAD', new AbortController().signal), { body: null });
  await assert.rejects(() => readWorkflowResponseBody(response('application/json'), operation, 'GET', AbortSignal.abort()), error => error.code === 'CANCELLED');
  await assert.rejects(() => readWorkflowResponseBody(response('not-a-media-type'), operation, 'GET', new AbortController().signal), error => error.code === 'MEDIA');
  await assert.rejects(() => readWorkflowResponseBody(response('not-a-media-type'), { ...operation, awsWire: 'sts-get-caller-identity' }, 'GET',
    new AbortController().signal), error => error.code === 'MEDIA');
  assert.equal(cancelled, 4);
  assert.equal(responseFileName('attachment; filename='), 'response.bin');
});
