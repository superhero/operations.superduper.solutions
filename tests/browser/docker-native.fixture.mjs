// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { dockerNativeFixture } from '../docker-native.fixture.mjs';

export function createDockerBrowserEndpoint() {
  const entries = new Map();
  async function handle(req, res, id, action) {
    const answer = value => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (action === 'create' && req.method === 'POST') {
      if (entries.has(id)) throw new Error();
      const fixture = await dockerNativeFixture({ applicationOrigin: 'http://' + req.headers.host }); entries.set(id, fixture);
      return answer({ host: fixture.host, pairingKey: fixture.key, daemonId: fixture.daemonId });
    }
    const f = entries.get(id); if (!f) throw new Error();
    if (action === 'observations' && req.method === 'GET') return answer({ engineRequests: f.engineRequests, requests: f.requests });
    if (action === 'change-daemon' && req.method === 'POST') { f.daemonId = randomUUID(); return answer({ changed: true }); }
    if (action === 'close' && req.method === 'DELETE') { await f.close(); entries.delete(id); return answer({ closed: true }); }
    throw new Error();
  }
  return { handle(req, res) {
    const match = /^\/docker-companion-fixture\/([a-f0-9-]{36})\/(create|observations|change-daemon|close)$/.exec(new URL(req.url, 'http://localhost').pathname);
    if (!match) return false;
    void handle(req, res, match[1], match[2]).catch(() => { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"docker_fixture_unavailable"}'); }); return true;
  }, async close() { for (const fixture of entries.values()) await fixture.close(); entries.clear(); } };
}
