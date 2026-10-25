// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeHostFixture } from '../native-runtime.fixture.mjs';
import { nativeAgentFixture } from '../native-agent.fixture.mjs';
import { openCodexRuntime } from '../../companions/codex/runtime.mjs';

/** Test control stays on the isolated harness origin. HTTPS, CORS, WSS and the
 * companion handler are real; only the default stdio peer is synthetic. */
export function createNativeBrowserEndpoint() {
  const entries = new Map();
  async function remove(entry) { await entry.fixture.close(); if (entry.directory) await rm(entry.directory, { recursive: true, force: true }); }
  async function handle(request, response, match) {
    const [, id, action] = match;
    const answer = value => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (action === 'create' && request.method === 'POST') {
      if (entries.has(id)) throw new Error();
      const parts = []; for await (const part of request) { parts.push(part); if (Buffer.concat(parts).length > 1024) throw new Error(); }
      const input = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
      const applicationOrigin = 'http://' + request.headers.host;
      let runtime, directory; const observation = { starts: 0, stops: 0, methods: [] };
      if (input.real === true) {
        if (!process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY || !process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256) throw new Error();
        directory = await mkdtemp(join(tmpdir(), 'operations-native-browser-'));
        const home = join(directory, 'home'), workspace = join(directory, 'workspace');
        await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
        const real = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
          binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace, allowAgent: input.agent === true });
        runtime = { authority: real.authority, async start(receive, exited) {
          observation.starts++; const child = await real.start(receive, exited); let closed = false;
          return { send(frame) { observation.methods.push(frame.method); child.send(frame); }, async close() {
            await child.close(); if (!closed) { closed = true; observation.stops++; }
          } };
        } };
      }
      const fixture = await (input.agent === true && !runtime ? nativeAgentFixture : nativeHostFixture)({ applicationOrigin,
        ...(input.wrongOrigin ? { allowedOrigins: ['https://foreign.test'] } : {}), ...(runtime ? { runtime } : {}), allowAgent: input.agent === true });
      entries.set(id, { fixture, directory, observation, real: !!runtime });
      return answer({ host: fixture.publicOrigin, pairingKey: fixture.key, real: !!runtime });
    }
    const entry = entries.get(id); if (!entry) throw new Error();
    if (action === 'observations' && request.method === 'GET') return answer({ requests: entry.fixture.requests, sockets: entry.fixture.sockets,
      starts: entry.real ? entry.observation.starts : entry.fixture.starts, stops: entry.real ? entry.observation.stops : entry.fixture.stops,
      methods: entry.real ? entry.observation.methods : entry.fixture.frames.map(frame => frame.method), real: entry.real });
    if (action === 'finish-login' && request.method === 'POST' && !entry.real && entry.fixture.finishLogin) { entry.fixture.finishLogin(); return answer({ completed: true }); }
    if (action === 'cut' && request.method === 'POST' && !entry.real) { entry.fixture.exit(); return answer({ closed: true }); }
    if (action === 'change-account' && request.method === 'POST' && !entry.real) { entry.fixture.identity.accountEpoch = randomUUID(); return answer({ changed: true }); }
    if (action === 'close' && request.method === 'DELETE') { await remove(entry); entries.delete(id); return answer({ closed: true }); }
    throw new Error();
  }
  return { handle(request, response) {
    const match = /^\/native-companion-fixture\/([a-f0-9-]{36})\/(create|observations|change-account|finish-login|cut|close)$/.exec(new URL(request.url, 'http://localhost').pathname);
    if (!match) return false;
    void handle(request, response, match).catch(() => { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"error":"native_fixture_unavailable"}'); });
    return true;
  }, async close() { for (const entry of entries.values()) await remove(entry); entries.clear(); } };
}
