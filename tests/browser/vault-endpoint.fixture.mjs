// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-server-only loopback endpoints; the outer runner has no external network.
import { gzipSync } from 'node:zlib';

export function createVaultEndpoint() {
  const requests = new Map();
  const expanded = Buffer.alloc(8 * 1024 * 1024 + 1, 'x');
  const compressed = gzipSync(expanded);
  return (request, response) => {
    const match = /^\/vault-api\/([a-z0-9-]+)\/([a-z-]+)$/.exec(request.url ?? '');
    if (!match) return false;
    const [, id, action] = match;
    response.setHeader('Cache-Control', 'no-store');
    if (action === 'observations') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(requests.get(id) ?? []));
      return true;
    }
    const seen = requests.get(id) ?? [];
    const record = { action, method: request.method, headers: request.headers, closed: false };
    seen.push(record); requests.set(id, seen);
    response.on('close', () => { record.closed = true; });
    if (action === 'redirect') {
      response.writeHead(307, { Location: `/vault-api/${id}/received` }); response.end();
    } else if (action === 'slow') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('still-running');
      const timer = setInterval(() => response.write('.'), 25);
      response.on('close', () => clearInterval(timer));
    } else if (action === 'compressed') {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': compressed.byteLength });
      response.end(compressed);
    } else if (action === 'chunked') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write(expanded.subarray(0, 1024)); response.end(expanded.subarray(1024));
    } else if (action === 'failure' || action === 'huge-failure') {
      response.writeHead(422, { 'Content-Type': 'application/json', 'X-Api-Key': request.headers['x-api-key'] ?? request.headers['xi-api-key'] ?? '' });
      response.end(JSON.stringify({ error: 'Synthetic endpoint refusal', echo: request.headers.authorization ?? '',
        apiKey: request.headers['x-api-key'] ?? request.headers['xi-api-key'] ?? '', detail: action === 'huge-failure' ? 'x'.repeat(32 * 1024) : 'safe diagnostic' }));
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Api-Key': request.headers['x-api-key'] ?? request.headers['xi-api-key'] ?? '' });
      response.end(JSON.stringify({ accepted: true, echo: request.headers.authorization ?? '', apiKey: request.headers['x-api-key'] ?? request.headers['xi-api-key'] ?? '' }));
    }
    return true;
  };
}
