// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import data from './lib/mistral-variant-contracts.json' with { type: 'json' };
import ids from '../tests/mistral-variant-operations.json' with { type: 'json' };
import { bindMistralVariants } from './lib/mistral-variant-contracts.ts';
import { mistralVariantProfile } from './lib/mistral-variant.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { readResponseStream, streamLimits } from './lib/workflow-response-stream.ts';
import { readWorkflowResponseBody } from './lib/workflow-response-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { createHttpConnection } from './lib/secrets/http-connections.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
const selected = new Set(ids), uuid = '12345678-1234-4234-8234-123456789012';
const bytes = new Uint8Array([0,255,128,10,13,65]), file = encodeWorkflowBinary('audio.wav', bytes, 'audio/wav');
const native = (document, contract) => document.paths[contract.path][contract.method.toLowerCase()];
Then('seven Mistral variants retain their identities shared schemas and reversible source operations', async () => {
  const source = await readServiceSchemaUpstream('mistral'), document = structuredClone(source); bindMistralVariants(document);
  assert.deepEqual(document.components, source.components); assert.deepEqual(document.servers, source.servers); assert.deepEqual(document.security, source.security);
  for (const [id, contract] of Object.entries(data.operations)) {
    const operation = native(document, contract), before = native(source, contract);
    assert.equal(operation.operationId, before.operationId, id); assert.deepEqual(operation.security, before.security);
    const parameters = structuredClone(operation.parameters);
    for (const parameter of parameters ?? []) if (parameter.name === 'connector_id') {
      assert.ok(parameter.schema.pattern); assert.equal(new RegExp(parameter.schema.pattern).test(uuid),true); assert.equal(new RegExp(parameter.schema.pattern).test('invalid'),false);
      delete parameter.schema.pattern; parameter.schema.format = 'uuid';
    }
    assert.deepEqual(parameters,before.parameters);
    assert.deepEqual(operation['x-upstream-mistral-variant'], before); document.paths[contract.path][contract.method.toLowerCase()] = operation['x-upstream-mistral-variant'];
  }
  assert.deepEqual(document, source); assert.equal(selected.size, 7);
});
Then('changed Mistral source contracts reject before any variant is adapted', async () => {
  const source = await readServiceSchemaUpstream('mistral'), last = Object.values(data.operations).at(-1);
  for (const change of [d => d.info.version += 'changed', d => d.servers[0].url = 'https://other.example.test', d => delete d.paths[last.path],
    d => native(d,last).parameters = [], d => d.components.schemas.ResponseDoneEvent.required = [], d => d.components.schemas.ConversationStreamRequest.allOf.pop(),
    d => native(d,last)['x-operations-mistral-variant'] = mistralVariantProfile]) {
    const document = structuredClone(source); change(document); const before = JSON.stringify(document);
    assert.throws(() => bindMistralVariants(document), /reviewed native source contract/); assert.equal(JSON.stringify(document), before);
  }
  bindMistralVariants(source); assert.throws(() => bindMistralVariants(source), /reviewed native source contract/);
});
let modelPromise;
function nativeModels() { return modelPromise ??= (async () => {
  const document = await readServiceSchema('mistral'), service = inspectServiceSchema(document, 'mistral', selected).operations;
  const narrow = structuredClone(document); narrow.paths = {};
  for (const contract of Object.values(data.operations)) (narrow.paths[contract.path] ??= {})[contract.method.toLowerCase()] = native(document, contract);
  const strict = extractOperations(narrow, 'mistral'); assert.equal(service.length, 7); assert.equal(strict.length, 7);
  for (const operation of [...service, ...strict]) assert.equal(operation.unavailableReason, undefined, operation.id);
  return { service, strict };
})(); }
function values(operation) {
  const result = {};
  for (const field of operation.fields.filter(field => field.location === 'path')) result[field.key] = field.name === 'connector_id_or_name' ? 'fixture-connector' : uuid;
  for (const field of operation.fields) {
    if (field.name === 'inputs') result[field.key] = field.type === 'string' ? 'Hello 世界' : JSON.stringify('Hello 世界');
    if (field.name === 'from_entry_id') result[field.key] = uuid;
    if (field.name === 'model') result[field.key] = operation.responseStream === 'mistral-transcription' ? 'voxtral-mini-latest' : 'mistral-small-latest';
  }
  if (operation.responseStream === 'mistral-transcription') Object.assign(result, { 'body:file': JSON.stringify(file), 'body:context_bias': '["fixture","word"]', 'body:timestamp_granularities': '["word","segment"]' });
  if (operation.id === 'mistral:connector_update_v1') result['body:name'] = 'Fixture connector';
  if (operation.id === 'mistral:connector_get_v1') result['query:fetch_customer_data'] = 'false';
  return result;
}
Then('all seven Mistral native variants retain distinct identities and qualified request models', async () => {
  for (const operations of Object.values(await nativeModels())) {
    assert.deepEqual(new Set(operations.map(operation => operation.id)), selected);
    for (const operation of operations) {
      assert.equal(operation.path, data.operations[operation.id].path); const request = prepareRequest(operation, values(operation)); assert.equal(request.path.includes('#'), false);
      if (operation.responseStream) { assert.equal(request.body.stream, true); assert.equal(operation.mistralVariant, mistralVariantProfile); }
    }
  }
});
const conversationEvents = text => [
  { event: 'conversation.response.started', data: { type: 'conversation.response.started', conversation_id: uuid } },
  { event: 'message.output.delta', data: { type: 'message.output.delta', content: text, role: 'assistant', index: 0, id: 'entry' } },
  { event: 'conversation.response.done', data: { type: 'conversation.response.done', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } } },
];
const transcriptionEvents = text => [
  { event: 'transcription.text.delta', data: { type: 'transcription.text.delta', text } },
  { event: 'transcription.done', data: { type: 'transcription.done', model: 'voxtral-mini-latest', text, language: 'en', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } } },
];
const encodeEvents = events => events.map(event => `event: ${event.event}\r\ndata: ${JSON.stringify(event.data)}\r\n\r\n`).join('');
function streamResponse(events, chunk = 1, close = false) {
  const payload = new TextEncoder().encode(typeof events === 'string' ? events : encodeEvents(events)); let offset = 0, cancelled = false;
  const body = new ReadableStream({ pull(controller) {
    if (offset < payload.length) { controller.enqueue(payload.slice(offset, offset + chunk)); offset += chunk; }
    else if (close) controller.close();
  }, cancel() { cancelled = true; } });
  return { response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), cancelled: () => cancelled };
}
async function authority(operation, saved = false) {
  const descriptor = await approvedOperation(operation, 'https://api.mistral.ai'), record = { id: crypto.randomUUID(), label: 'Mistral fixture', kind: 'secret', value: 'private-mistral-variant-token-971', grants: [] };
  const binding = { alternative: 0, credentials: { ApiKey: record.id }, fingerprint: descriptor.fingerprint };
  if (saved) { const connection = await createHttpConnection({ label: 'Mistral fixture', account: 'Synthetic', format: 'schema' }, descriptor, binding, [record]); record.connections = [connection]; binding.credentials = {}; binding.connection = { id: connection.id, revision: connection.revision, fingerprint: connection.fingerprint }; }
  return { descriptor, record, binding };
}
Then('seven Mistral operations execute their native private JSON multipart and connector requests', async () => {
  let count = 0;
  for (const operation of (await nativeModels()).service) {
    const input = values(operation), prepared = prepareRequest(operation,input), a = await authority(operation); let failure;
    const events = operation.responseStream === 'mistral-transcription' ? transcriptionEvents('Hello 世界') : conversationEvents('Hello 世界');
    const result = await executeCredentialed(a.descriptor, input, a.binding, [a.record], { assertCurrent() {}, async fetchRequest(url, init) {
      count++; try {
        assert.equal(new URL(url).hash, ''); assert.equal(new URL(url).pathname, prepared.path); assert.equal(init.method, operation.method);
        const headers = new Headers(init.headers); assert.equal(headers.get('Authorization'), 'Bearer '+a.record.value);
        assert.equal(headers.get('Accept'), operation.responseStream ? 'text/event-stream' : 'application/json');
        if (operation.responseStream === 'mistral-transcription') { assert.equal(headers.get('Content-Type'), null); const form = await new Request(String(url),init).formData(); assert.equal(form.get('stream'),'true'); assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()),bytes); assert.deepEqual(form.getAll('context_bias'),['fixture','word']); assert.deepEqual(form.getAll('timestamp_granularities'),['word','segment']); }
        else if (operation.responseStream) { const body = JSON.parse(String(init.body)); assert.equal(body.stream,true); assert.deepEqual(body,prepared.body); }
        else if (operation.id.endsWith('connector_get_v1')) assert.equal(new URL(url).searchParams.get('fetch_customer_data'),'false');
      } catch (error) { failure = error; }
      return operation.responseStream ? streamResponse(events,17).response : Response.json({ id: uuid, name: 'Fixture connector', description: '', created_at: '2026-11-06T00:00:00Z', modified_at: '2026-11-06T00:00:00Z' });
    } }).catch(error => { throw new Error(operation.id+': '+error.message,{cause:error}); });
    if (failure) throw failure;
    if (operation.responseStream) assert.deepEqual(result.response.body,{events});
    assert.equal(JSON.stringify(result).includes(a.record.value),false);
  }
  assert.equal(count,7);
});
Then('Mistral streams preserve UTF8 event envelopes and cancel their producer at the terminal event', async () => {
  for (const profile of ['mistral-conversation','mistral-transcription']) {
    const events = profile === 'mistral-conversation' ? conversationEvents('Hello 🌍 世界') : transcriptionEvents('Hello 🌍 世界');
    for (const chunk of [1,3,97]) { const source = streamResponse(events,chunk); const progress = []; const result = await readResponseStream(source.response,profile,new AbortController().signal,value => progress.push(value)); assert.deepEqual(result.body,{events}); assert.equal(result.stream.events,events.length); assert.ok(source.cancelled()); assert.ok(progress.every(value => Object.keys(value).length === 2)); }
  }
});
Then('invalid incomplete oversized and cancelled Mistral streams fail within their resource budget', async () => {
  const signal = new AbortController().signal;
  const cases = [conversationEvents('partial').slice(0,-1), [{event:'conversation.response.error',data:{type:'conversation.response.error',message:'provider failure',code:500}}],
    [{event:'message.output.delta',data:{type:'conversation.response.done',usage:{}}}], [{event:'conversation.response.done',data:{type:'conversation.response.done'}}],
    [{event:'conversation.response.started',data:{type:'conversation.response.started',conversation_id:'one'}},{event:'conversation.response.started',data:{type:'conversation.response.started',conversation_id:'two'}}],
    [{event:'unknown',data:{type:'unknown'}}], 'data: invalid-json\r\n\r\n', 'data: '+ 'a'.repeat(streamLimits.frameCharacters+1)+'\n\n'];
  for (const events of cases) await assert.rejects(() => readResponseStream(streamResponse(events,65536,true).response,'mistral-conversation',signal));
  await assert.rejects(() => readResponseStream(streamResponse(Array.from({length:streamLimits.events+1},()=>conversationEvents('delta')[1]),65536,true).response,'mistral-conversation',signal));
  const aborted = new AbortController(); aborted.abort(); const source = streamResponse(conversationEvents('cancel')); await assert.rejects(() => readResponseStream(source.response,'mistral-conversation',aborted.signal)); assert.ok(source.cancelled());
  const operation = (await nativeModels()).service.find(operation => operation.responseStream);
  await assert.rejects(() => readWorkflowResponseBody(Response.json({events:[]}),operation,'POST',signal));
  await assert.rejects(() => readResponseStream(new Response(new Uint8Array([255]),{headers:{'Content-Type':'text/event-stream'}}),'mistral-conversation',signal));
});
Then('stream false forged Mistral selectors and changed approvals cannot dispatch', async () => {
  for (const operation of (await nativeModels()).service.filter(operation => operation.responseStream)) for (const value of ['false','null','1','"true"']) assert.throws(() => prepareRequest(operation,{...values(operation),'body:stream':value}),InputValidationError);
  for (const operation of (await nativeModels()).service.filter(operation => operation.fields.some(field => field.key === 'path:connector_id')))
    assert.throws(() => prepareRequest(operation,{...values(operation),'path:connector_id':'not-a-uuid'}),InputValidationError);
  const operation = (await nativeModels()).service[0], a = await authority(operation);
  for (const change of [o => delete o.mistralVariant, o => o.path += '#other', o => o.id += '-other', o => o.method = 'GET', o => o.responseStream = 'sse-json']) { const forged = structuredClone(operation); change(forged); await assert.rejects(() => approvedOperation(forged,a.descriptor.origin),error => error.code === 'PERMISSION'); }
  const changed = structuredClone(operation); changed.fields[0].description += 'changed'; const descriptor = await approvedOperation(changed,a.descriptor.origin); assert.notEqual(descriptor.fingerprint,a.descriptor.fingerprint); let calls = 0;
  await assert.rejects(() => executeCredentialed(descriptor,values(changed),a.binding,[a.record],{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),error => error.code === 'PERMISSION'); assert.equal(calls,0);
});
Then('a saved Mistral connection preserves its variant and scrubs credential echoes from events', async () => {
  const operation = (await nativeModels()).service.find(operation => operation.responseStream === 'mistral-conversation'), a = await authority(operation,true); let calls = 0;
  const result = await executeCredentialed(a.descriptor,values(operation),a.binding,[a.record],{assertCurrent(){},async fetchRequest(url,init){calls++;assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+a.record.value);return streamResponse(conversationEvents('echo '+a.record.value),17).response;}});
  assert.equal(calls,1); assert.equal(JSON.stringify(result).includes(a.record.value),false); assert.equal(result.response.redacted,true);
});
