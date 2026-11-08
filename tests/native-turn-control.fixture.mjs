// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeThreadShellFixture } from './native-thread-shell.fixture.mjs';

/** A held local response stream supplies deterministic model output, with no live inference. */
export async function seedNativeTurnProvider(home) {
  const f = { requests: [], pending: [] }; let number = 0;
  const server = createServer(async (request, response) => {
    const chunks = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(chunk); }
    const path = new URL(request.url, 'http://owned.invalid').pathname;
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    f.requests.push({ method: request.method, path, body });
    if (request.method === 'GET' && path === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"object":"list","data":[]}'); return; }
    if (request.method !== 'POST' || path !== '/v1/responses') { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":{"message":"Unreviewed owned provider route."}}'); return; }
    const id = 'owned_response_' + ++number;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); response.flushHeaders();
    const event = (type, payload) => response.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...payload }) + '\n\n');
    event('response.created', { response: { id, object: 'response', model: 'owned-fixture-model', status: 'in_progress', output: [] } });
    const entry = { body, closed: false, finishTool(name, argumentsValue) {
      if (entry.closed) return;
      const item = { id: 'function_' + id, call_id: 'call_' + id, type: 'function_call', name, arguments: JSON.stringify(argumentsValue) };
      event('response.output_item.added', { output_index: 0, item: { ...item, arguments: '' } });
      event('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } });
      response.end();
    }, finish(text = 'Owned fixture answer.') {
      if (entry.closed) return;
      const item = { id: 'message_' + number, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } });
      response.end();
    } };
    response.once('close', () => { entry.closed = true; }); f.pending.push(entry);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(home, 'config.toml'), 'model="owned-fixture-model"\nmodel_provider="owned_turn_provider"\n'
    + '[model_providers.owned_turn_provider]\nname="Owned turn fixture"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n'
    + 'base_url="http://127.0.0.1:' + server.address().port + '/v1"\n', { mode: 0o600 });
  f.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }; return f;
}

export async function nativeTurnControlFixture(options = {}) {
  const f = await nativeThreadShellFixture({ ...options, manualTurn: true, providerFactory: seedNativeTurnProvider,
    onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      if (frame.method === 'turn/start' && options.holdStartup) { f.startupFrame = frame; return true; }
      if (frame.method === 'turn/steer') {
        f.steered = structuredClone(frame.params);
        queueMicrotask(() => emit(f.controlError ? { id: frame.id, error: { code: -32000, message: 'Owned control failure.' } }
          : { id: frame.id, result: { turnId: f.wrongSteerAck ? 'foreign_turn' : frame.params.expectedTurnId } })); return true;
      }
      if (frame.method === 'turn/interrupt') {
        f.interrupts = (f.interrupts ?? 0) + 1;
        const ack = () => emit({ id: frame.id, result: {} });
        const finish = () => f.startupFrame ? emit({ id: f.startupFrame.id, error: { code: -32000, message: 'Owned startup interrupted.' } }) : f.completeTurn('interrupted');
        queueMicrotask(() => { if (options.ackFirst) { ack(); finish(); } else { finish(); ack(); } }); return true;
      }
      return false;
    } });
  if (options.real) f.runtime.requestMs = 15000;
  return f;
}
