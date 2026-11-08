// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { nativeMcpOAuthServer } from './native-mcp-oauth-server.fixture.mjs';
import { seedNativeMcpTool } from './native-mcp-tool.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export async function nativeMcpOAuthFixture(options = {}) {
  let authority, provider, f;
  const allowAgent = options.allowAgent ?? false, allowMcpOAuth = options.allowMcpOAuth ?? true;
  try { f = await nativeAgentFixture({ ...options, allowAgent, allowMcpOAuth, account: options.account ?? null,
    ...(options.real ? { async runtimeFactory(f) {
      let prefix = '';
      if (allowAgent) { provider = await seedNativeMcpTool(f.home); prefix = await readFile(join(f.home, 'config.toml'), 'utf8'); }
      authority = await nativeMcpOAuthServer(f.home, { cimd: options.cimd ?? true, prefix }); f.authorityServer = authority;
      const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
        allowMcpOAuth, allowAgent, allowMcpRead: options.allowMcpRead === true, allowMcpTools: options.allowMcpTools === true });
      return { authority: runtime.authority, prepareQuery: runtime.prepareQuery, async start(receive, exited) {
        f.starts++; const child = await runtime.start(receive, exited); let stopped = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
      } };
    } } : {}), onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      if (frame.method === 'mcpServer/oauth/login') {
        const loginId = randomUUID(), p = frame.params;
        f.finishMcp = (patch = {}) => emit({ method: 'mcpServer/oauthLogin/completed', params: {
          name: p.name, loginId, threadId: p.threadId ?? null, success: true, error: null, ...patch } });
        const reply = () => emit({ id: frame.id, result: f.mcpAcknowledgement ?? { authorizationUrl: 'https://oauth.operations.test/authorize?state=owned', loginId } });
        if (options.early) f.finishMcp();
        if (f.holdMcpAck) f.release.push(reply); else queueMicrotask(reply); return true;
      }
      if (frame.method === 'mcpServer/tool/call') { queueMicrotask(() => emit({ id: frame.id, result: { content: [{ type: 'text', text: 'Owned tool after sign-in.' }], isError: false } })); return true; }
      if (frame.method === 'mcpServer/resource/read') { queueMicrotask(() => emit({ id: frame.id, result: { contents: [{ uri: frame.params.uri, text: 'Owned OAuth resource available.' }] } })); return true; }
      return false;
    } });
  } catch (error) { await authority?.close(); await provider?.close(); throw error; }
  if (options.real) f.runtime.requestMs = 10000;
  const close = f.close; f.close = async () => { try { await close(); } finally { await authority?.close(); await provider?.close(); } };
  return f;
}
