// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { handleJiraNodeRequest } from '../../companions/jira/server.mjs';
import { jiraHostFixture, jiraSites, jiraAccountId } from '../jira-companion.fixture.mjs';

/** A real loopback companion for native Fetch/CORS; only Atlassian is synthetic. */
export function createJiraBrowserEndpoint() {
  const active = new Map();
  const close = async entry => { await entry.host.close(); entry.server.closeAllConnections(); await new Promise(resolve => entry.server.close(resolve)); };
  async function handle(request, response, match) {
    const [, id, action] = match;
    const result = value => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (action === 'create' && request.method === 'POST') {
      if (active.has(id)) throw new Error();
      let host; const events = [];
      const server = createServer((incoming, outgoing) => {
        const url = new URL(incoming.url, 'http://localhost');
        events.push({ method: incoming.method, path: url.pathname, origin: incoming.headers.origin,
          requestedHeaders: incoming.headers['access-control-request-headers'] ?? '',
          sentAuthorization: !!incoming.headers.authorization, sentClaim: !!incoming.headers['x-operations-claim'],
          sentConnection: !!incoming.headers['x-operations-connection'], sentCookie: !!incoming.headers.cookie });
        void handleJiraNodeRequest(host.host, host.config.publicOrigin, incoming, outgoing);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const publicOrigin = 'http://127.0.0.1:' + server.address().port;
      host = await jiraHostFixture({ publicOrigin, applicationOrigin: 'http://' + request.headers.host });
      active.set(id, { host, server, events });
      return result({ publicOrigin, cloudId: jiraSites[0].id, siteUrl: jiraSites[0].url, accountId: jiraAccountId });
    }
    const entry = active.get(id); if (!entry) throw new Error();
    if (action === 'expire' && request.method === 'POST') { entry.host.advance(3600001); return result({ advanced: true }); }
    if (action === 'observations' && request.method === 'GET') return result({ events: entry.events,
      providers: entry.host.providerCalls.map(call => ({ method: call.method, url: call.address,
        ...(call.address === 'https://auth.atlassian.com/oauth/token' ? { grant: JSON.parse(call.body).grant_type } : {}) })),
      storedConnections: (await entry.host.store.list()).length });
    if (action === 'close' && request.method === 'DELETE') { await close(entry); active.delete(id); return result({ closed: true }); }
    throw new Error();
  }
  return {
    handle(request, response) {
      const match = /^\/jira-companion-fixture\/([a-f0-9-]{36})\/(create|expire|observations|close)$/.exec(new URL(request.url, 'http://localhost').pathname);
      if (!match) return false;
      void handle(request, response, match).catch(() => { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"error":"fixture unavailable"}'); });
      return true;
    },
    async close() { for (const entry of active.values()) await close(entry); active.clear(); },
  };
}
