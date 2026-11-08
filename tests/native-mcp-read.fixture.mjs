// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeMcpUri, nativeMcpText, nativeMcpTool } from './native-mcp-server.fixture.mjs';

export async function seedNativeMcpRead(home) {
  const server = new URL('./native-mcp-server.fixture.mjs', import.meta.url).pathname;
  await writeFile(join(home, 'config.toml'), '[mcp_servers.operations_fixture]\ncommand = ' + JSON.stringify(process.execPath)
    + '\nargs = [' + JSON.stringify(server) + ']\nstartup_timeout_sec = 5\ntool_timeout_sec = 5\n', { mode: 0o600 });
}
export const nativeMcpResults = () => ({
  'mcpServerStatus/list': { data: [{ name: 'operations_fixture', authStatus: 'unsupported',
    tools: { display_only: structuredClone(nativeMcpTool) }, resources: [{ name: 'Owned resource', uri: nativeMcpUri }], resourceTemplates: [],
    serverCapabilities: { tools: {}, resources: {} }, serverInfo: { name: 'operations-fixture', version: '1.0.0' },
    httpOrigin: null, runtimeStatus: null, pluginId: null, toolsError: null }], nextCursor: null },
  'mcpServer/resource/read': { contents: [{ uri: nativeMcpUri, text: nativeMcpText, _meta: { fixture: [true, null, 2] } },
    { uri: nativeMcpUri, blob: Buffer.from([0, 1, 2, 255]).toString('base64') }], originCallId: null }
});
export function nativeMcpReadFixture(options = {}) {
  const allowMcpRead = options.allowMcpRead ?? true;
  return nativeHostFixture({ ...options, allowMcpRead, ...(options.real ? { async runtimeFactory(f) {
    await seedNativeMcpRead(f.home);
    const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
      executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, allowMcpRead });
    return { authority: runtime.authority, prepareQuery: runtime.prepareQuery, async start(receive, exited) {
      f.starts++; const child = await runtime.start(receive, exited); let stopped = false;
      return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() {
        await child.close(); if (!stopped) { stopped = true; f.stops++; }
      } };
    } };
  } } : {}), onFrame(frame, f, receive) {
    if (options.onFrame?.(frame, f, receive) === true) return true;
    const results = f.mcpResults ??= nativeMcpResults(); if (!Object.hasOwn(results, frame.method)) return false;
    const reply = () => receive(f.failMcp ? { id: frame.id, error: { code: -32000, message: 'Private configured-server failure details.' } }
      : { id: frame.id, result: structuredClone(results[frame.method]) });
    if (f.holdMcp) f.release.push(reply); else queueMicrotask(reply); return true;
  } });
}
