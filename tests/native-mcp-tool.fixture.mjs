// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedNativeMcpRead } from './native-mcp-read.fixture.mjs';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

/** A provider config avoids external model discovery. No completion endpoint is implemented. */
export async function seedNativeMcpTool(home) {
  const requests = [], server = createServer((request, response) => {
    requests.push({ path: request.url, hasAuthorization: !!request.headers.authorization });
    response.writeHead(request.url?.startsWith('/v1/models') ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url?.startsWith('/v1/models') ? { object: 'list', data: [] } : { error: { message: 'Inference is not implemented by this owned fixture.' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  try {
    await seedNativeMcpRead(home); const mcp = await readFile(join(home, 'config.toml'), 'utf8');
    await writeFile(join(home, 'config.toml'), 'model = "owned-fixture-model"\nmodel_provider = "operations_fixture"\n'
      + '[model_providers.operations_fixture]\nname = "Owned qualification provider"\nwire_api = "responses"\nrequires_openai_auth = false\n'
      + 'base_url = "http://127.0.0.1:' + server.address().port + '/v1"\n' + mcp, { mode: 0o600 });
    return { requests, close };
  } catch (error) { await close(); throw error; }
}
export async function nativeMcpToolFixture(options = {}) {
  const allowMcpTools = options.allowMcpTools ?? true; let provider;
  let f;
  try { f = await nativeAgentFixture({ ...options, allowMcpTools, account: Object.hasOwn(options, 'account') ? options.account : { type: 'apiKey' }, ...(options.real ? { async runtimeFactory(f) {
    provider = await seedNativeMcpTool(f.home); f.provider = provider;
    const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
      executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
      allowAgent: true, allowMcpTools });
    return { authority: runtime.authority, async start(receive, exited) {
      f.starts++; const child = await runtime.start(frame => {
        if (frame.error) (f.sdkFailures ??= []).push({ code: frame.error.code, message: String(frame.error.message).replaceAll(f.home, '<owned-home>').slice(0, 1000) });
        receive(frame);
      }, exited); let stopped = false;
      return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
    } };
  } } : {}), onFrame(frame, f, emit) {
    if (options.onFrame?.(frame, f, emit) === true) return true;
    if (frame.error && frame.id === 'owned_mcp_interaction') { (f.mcpReplies ??= []).push(frame); return true; }
    if (frame.method !== 'mcpServer/tool/call') return false;
    const params = frame.params, metadata = params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
      ? { ...params._meta, threadId: params.threadId } : Object.hasOwn(params, '_meta') ? params._meta : { threadId: params.threadId };
    const result = f.mcpToolResult ?? { content: [{ type: 'text', text: 'Owned MCP tool: ' + String(params.arguments?.message ?? '') }],
      structuredContent: { arguments: params.arguments ?? null, metadata }, isError: false, _meta: { fixture: true } };
    const reply = () => emit(f.failMcpTool ? { id: frame.id, error: { code: -32602, message: 'Private SDK tool failure details.' } } : { id: frame.id, result: structuredClone(result) });
    if (f.interactMcpTool) emit({ id: 'owned_mcp_interaction', method: 'mcpServer/elicitation/request', params: { threadId: params.threadId, serverName: params.server, request: { mode: 'form', message: 'Not authorized by tool grant.' } } });
    if (f.holdMcpTool) f.release.push(reply); else queueMicrotask(reply); return true;
  } });
  } catch (error) { await provider?.close(); throw error; }
  if (options.real) f.runtime.requestMs = 10000;
  const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } }; return f;
}
