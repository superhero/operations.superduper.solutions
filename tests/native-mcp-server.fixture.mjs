// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Owned qualification MCP. It implements reads only and never accesses a network or user files.
import { createInterface } from 'node:readline';
export const nativeMcpUri = 'operations-fixture://readme';
export const nativeMcpText = 'Owned MCP resource fixture.';
export const nativeMcpTool = { name: 'display_only', description: 'Owned echo tool used only for qualification.',
  inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  annotations: { readOnlyHint: true }, _meta: { fixture: true } };
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    if (line.length > 65536) return process.exit(2);
    const request = JSON.parse(line); if (!Object.hasOwn(request, 'id')) return;
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'operations-fixture', version: '1.0.0' } };
    else if (request.method === 'tools/list') result = { tools: [nativeMcpTool] };
    else if (request.method === 'resources/list') result = { resources: [{ name: 'Owned resource', uri: nativeMcpUri, mimeType: 'text/plain' }] };
    else if (request.method === 'resources/templates/list') result = { resourceTemplates: [] };
    else if (request.method === 'resources/read' && request.params.uri === nativeMcpUri) result = { contents: [
      { uri: nativeMcpUri, mimeType: 'text/plain', text: nativeMcpText, _meta: { fixture: [true, null, 2] } },
      { uri: nativeMcpUri, mimeType: 'application/octet-stream', blob: Buffer.from([0, 1, 2, 255]).toString('base64') }
    ] };
    else if (request.method === 'tools/call' && request.params.name === 'display_only') result = {
      content: [{ type: 'text', text: 'Owned MCP tool: ' + String(request.params.arguments?.message ?? '') }],
      structuredContent: { arguments: request.params.arguments ?? null, metadata: request.params._meta ?? null }, isError: false, _meta: { fixture: true }
    };
    else if (request.method === 'ping') result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(result ? { result }
      : { error: { code: -32601, message: 'Owned fixture method unavailable.' } }) }) + '\n');
  });
  lines.on('close', () => process.exit(0));
}
