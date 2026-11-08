// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { prepareNativeConfigurationControl, reviewNativeConfigurationControl } from '../companions/codex/configuration-control.mjs';
import { prepareNativeConfigurationRead, reviewNativeConfigurationRead } from '../companions/codex/configuration-read.mjs';
import { createServer, request } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { createCodexCompanion } from '../companions/codex/host.mjs';
import { nativeRuntimeProfile, nativeRuntimeVersion } from '../src/lib/native-runtime-contract.ts';
import { prepareNativeQueryPaths } from '../companions/codex/query.mjs';
import { prepareNativeFeedback } from '../companions/codex/feedback.mjs';
import { prepareNativeFilesystemWatch, reviewNativeFilesystemChange } from '../companions/codex/filesystem-watch.mjs';
import { prepareNativeCommand, reviewNativeCommand } from '../companions/codex/command.mjs';
import { reviewNativeFilesystemRead } from '../companions/codex/filesystem-read.mjs';
import { prepareNativeStoredThreadRead, reviewNativeStoredThreadRead } from '../companions/codex/stored-thread.mjs';
import { prepareNativeThreadLifecycle, reviewNativeThreadLifecycle } from '../companions/codex/thread-lifecycle.mjs';
import { reviewNativeAccountMetadata } from '../companions/codex/account-read.mjs';
import { nativeGuardianEvent } from '../src/lib/native-guardian.ts';
import { pathToFileURL } from 'node:url';
import { prepareNativePluginRead, reviewNativePluginRead } from '../companions/codex/plugin-read.mjs';

export async function nativeTlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-native-tls-'));
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', join(directory, 'key'), '-out', join(directory, 'cert')], { timeout: 10000, maxBuffer: 8192 });
  return { directory, key: await readFile(join(directory, 'key')), cert: await readFile(join(directory, 'cert')),
    close: () => rm(directory, { recursive: true, force: true }) };
}
export async function nativeHostFixture(options = {}) {
  const tls = await nativeTlsFixture(), applicationOrigin = options.applicationOrigin ?? 'https://operations.test';
  const key = randomBytes(32).toString('base64url'); let offset = 0, host;
  const f = { key, applicationOrigin, starts: 0, stops: 0, frames: [], requests: [], sockets: [], hold: false, echo: false, account: options.account ?? null, requiresOpenaiAuth: options.requiresOpenaiAuth ?? true,
    identity: { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion,
      configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() }, now: () => Date.now() + offset,
    advance: ms => offset += ms, release: [] };
  if (options.allowWindowsSandboxReadiness !== undefined || options.allowPluginSharing !== undefined || options.allowPluginManagement !== undefined || options.allowMarketplaces !== undefined || options.allowPluginsRead !== undefined || options.allowGuardian !== undefined || options.allowAccountActions !== undefined || options.allowGatewayOAuth !== undefined || options.allowAccountAuth !== undefined || options.allowAccountRead !== undefined || options.allowThreadsWrite !== undefined || options.allowThreadsRead !== undefined || options.allowMigration || options.allowConfigurationWrite !== undefined || options.allowConfigurationControl !== undefined || options.allowConfigurationRead !== undefined || options.allowThreadShell !== undefined || options.allowMetadata || options.allowApps || options.allowFeedback || options.allowFilesystemRead || options.allowFilesystemWrite || options.allowFilesystemWatch || options.allowSectionsRead || options.allowSectionsWrite || options.allowMcpRead || options.allowMcpTools || options.allowMcpOAuth || options.allowCommands) {
    f.workspace = join(tls.directory, 'workspace'); f.home = options.allowMigration ? join(tls.directory, 'migration', 'codex') : join(tls.directory, 'home');
    if (options.allowMigration) await mkdir(dirname(f.home), { mode: 0o700 });
    await mkdir(f.workspace, { mode: 0o700 }); await mkdir(f.home, { mode: 0o700 });
  }
  const runtime = options.runtime ?? await options.runtimeFactory?.(f) ?? { now: f.now, authority: async () => structuredClone(f.identity),
    ...(options.allowPluginsRead ? {
      preparePluginRead: (method, params) => prepareNativePluginRead(method, params, { workspace: f.workspace, home: f.home, inspect: async cwd => f.pluginConfigs?.get(cwd) ?? f.pluginConfig ?? { layers: [] } }),
      reviewPluginRead: async (plan, result) => { await f.onPluginReadReview?.(); return reviewNativePluginRead(plan, result, { workspace: f.workspace, home: f.home }); }
    } : {}),
    ...(options.allowAccountAuth ? { reviewAccountMetadata: result => reviewNativeAccountMetadata(result, f.home) } : {}),
    ...(options.allowMetadata || options.allowApps || options.allowFilesystemRead || options.allowFilesystemWrite || options.allowSectionsRead || options.allowSectionsWrite || options.allowMcpRead ? { prepareQuery: (method, params) => prepareNativeQueryPaths(method, params, f.workspace, f.home) } : {}),
    ...(options.allowCommands ? { prepareCommand: params => prepareNativeCommand(params, f.workspace, f.home), reviewCommand: async root => { await f.onCommandReview?.(); return reviewNativeCommand(root, f.workspace, f.home); } } : {}),
    ...(options.allowFilesystemWatch ? { prepareWatch: params => prepareNativeFilesystemWatch(params, f.workspace, f.home), reviewWatchChange: async (root, paths) => { await f.onWatchReview?.(); return reviewNativeFilesystemChange(root, paths, f.workspace, f.home); } } : {}),
    ...(options.allowFilesystemRead ? { reviewQueryResult: (method, params, result) => reviewNativeFilesystemRead(method, params, result, f.workspace, f.home) } : {}),
    ...(options.allowFeedback ? { prepareFeedback: params => prepareNativeFeedback(params, { workspace: f.workspace, home: f.home, pairingKey: f.key, allowDiagnostics: options.allowFeedbackDiagnostics === true }) } : {}),
    ...(options.allowConfigurationControl ? { prepareConfigurationControl: (method, params) => prepareNativeConfigurationControl(method, params, f.workspace, f.home), reviewConfigurationControl: (method, params, value) => reviewNativeConfigurationControl(method, params, value, f.workspace, f.home) } : {}),
    ...(options.allowConfigurationRead ? { prepareConfigurationRead: (method, params) => prepareNativeConfigurationRead(method, params, f.workspace, f.home), reviewConfigurationRead: reviewNativeConfigurationRead } : {}),
    ...(options.allowThreadsRead ? {
      prepareStoredThreadRead: (method, params) => prepareNativeStoredThreadRead(method, params, { workspace: f.workspace, home: f.home, inspect: id => f.inspectStoredThread(id) }),
      reviewStoredThreadRead: (method, params, value) => reviewNativeStoredThreadRead(method, params, value, { workspace: f.workspace, home: f.home, inspect: id => f.inspectStoredThread(id) })
    } : {}),
    ...(options.allowThreadsWrite ? {
      prepareThreadLifecycle: (method, params) => prepareNativeThreadLifecycle(method, params, { workspace: f.workspace, home: f.home, sqliteRoot: f.home, inspect: id => f.inspectStoredThread(id), loaded: async () => [] }),
      reviewThreadLifecycle: (plan, value) => reviewNativeThreadLifecycle(plan, value, { workspace: f.workspace, home: f.home, inspect: id => f.inspectStoredThread(id) })
    } : {}),
    async prepareGuardianDenial(denial) {
      if (options.allowGuardian !== true || JSON.stringify(denial).includes(f.key)) throw new Error('Owned Guardian fixture denied the action.');
      return nativeGuardianEvent(denial, path => pathToFileURL(path).href);
    },
    async start(receive, exited) {
      f.starts++; f.emit = receive; f.exit = exited; let stopped = false;
      return { send(frame) {
        f.frames.push(structuredClone(frame));
        if (options.onFrame?.(frame, f, receive) === true) return;
        if (!Object.hasOwn(frame, 'id')) return;
        const result = frame.method === 'initialize' ? { userAgent: 'codex/0.163.0', codexHome: '/private/owned-codex', platformFamily: 'unix', platformOs: 'linux' }
          : { account: f.account, requiresOpenaiAuth: f.requiresOpenaiAuth, ...(Object.hasOwn(f, 'workspaceRouting') ? { workspaceRouting: f.workspaceRouting } : {}), ...(f.echo ? { echo: key } : {}) };
        const reply = () => { if (!stopped) receive({ id: frame.id, result }); };
        if (f.hold && frame.method === 'account/read') f.release.push(reply); else queueMicrotask(reply);
      }, async close() { if (!stopped) { stopped = true; f.stops++; options.onClose?.(f); exited(); } } };
    } };
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    f.requests.push({ path: req.url, method: req.method, origin: req.headers.origin, authorization: !!req.headers.authorization,
      cookie: !!req.headers.cookie, requestedHeaders: req.headers['access-control-request-headers'] ?? '' });
    void host.handle(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const publicOrigin = 'https://127.0.0.1:' + server.address().port;
  host = createCodexCompanion({ publicOrigin, pairingKey: key, allowedOrigins: options.allowedOrigins ?? [applicationOrigin], allowAgent: options.allowAgent === true, allowGuardian: options.allowGuardian === true, allowMetadata: options.allowMetadata === true, allowApps: options.allowApps === true,
    allowFeedback: options.allowFeedback === true, allowFeedbackDiagnostics: options.allowFeedbackDiagnostics === true, allowFilesystemRead: options.allowFilesystemRead === true, allowFilesystemWrite: options.allowFilesystemWrite === true, allowFilesystemWatch: options.allowFilesystemWatch === true, allowSectionsRead: options.allowSectionsRead === true, allowSectionsWrite: options.allowSectionsWrite === true, allowMcpRead: options.allowMcpRead === true, allowMcpTools: options.allowMcpTools === true, allowMcpOAuth: options.allowMcpOAuth === true, allowCommands: options.allowCommands === true, allowThreadShell: options.allowThreadShell === true, allowAccountAuth: options.allowAccountAuth === true, allowGatewayOAuth: options.allowGatewayOAuth === true, allowAccountActions: options.allowAccountActions === true, allowAccountRead: options.allowAccountRead === true, allowThreadsRead: options.allowThreadsRead === true, allowThreadsWrite: options.allowThreadsWrite === true, allowMarketplaces: options.allowMarketplaces === true, allowPluginManagement: options.allowPluginManagement === true, allowPluginSharing: options.allowPluginSharing === true, allowWindowsSandboxReadiness: options.allowWindowsSandboxReadiness === true, allowPluginsRead: options.allowPluginsRead === true, allowConfigurationRead: options.allowConfigurationRead === true, allowConfigurationControl: options.allowConfigurationControl === true, allowConfigurationWrite: options.allowConfigurationWrite === true, allowMigration: options.allowMigration === true }, runtime);
  server.on('upgrade', (req, socket, head) => {
    f.sockets.push({ path: req.url, origin: req.headers.origin, protocol: req.headers['sec-websocket-protocol'], cookie: !!req.headers.cookie });
    host.upgrade(req, socket, head);
  });
  f.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers)); headers.origin ??= applicationOrigin;
    const req = request(url, { method: init.method ?? 'GET', headers, rejectUnauthorized: false, signal: init.signal }, res => {
      const chunks = []; res.on('data', part => chunks.push(part)); res.on('end', () => resolve(new Response(
        res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(init.body);
  });
  f.Socket = class extends WebSocket { constructor(url) { super(url, { origin: applicationOrigin, rejectUnauthorized: false }); } };
  f.runtime = { fetch: f.fetch, WebSocket: f.Socket, now: f.now, requestMs: 1000 };
  f.publicOrigin = publicOrigin; f.host = host; f.server = server;
  f.ticket = async (scope = { connectionId: randomUUID(), method: 'account/read', fingerprint: 'c'.repeat(64) }, headers = {}) => {
    const response = await f.fetch(publicOrigin + '/v1/codex/tickets', { method: 'POST', headers: {
      Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ profile: nativeRuntimeProfile, version: nativeRuntimeVersion, scope }) });
    return { status: response.status, value: response.status === 200 ? await response.json() : undefined };
  };
  f.socket = async (ticket, options = {}) => {
    const ws = new WebSocket(publicOrigin.replace('https:', 'wss:') + '/v1/codex/socket', { origin: applicationOrigin, rejectUnauthorized: false, ...options });
    const messages = [], waits = [];
    ws.on('message', data => { const value = JSON.parse(data.toString()); messages.push(value); for (const done of waits.splice(0)) done(); });
    ws.on('error', () => {});
    await new Promise(resolve => { ws.once('open', () => { if (ticket) ws.send(JSON.stringify({ type: 'pair', ticket })); resolve(); }); ws.once('error', resolve); });
    return { ws, messages, async next() {
      const count = messages.length;
      if (!count) await new Promise(resolve => { const timer = setTimeout(resolve, 1500); waits.push(() => { clearTimeout(timer); resolve(); }); ws.once('close', () => { clearTimeout(timer); resolve(); }); });
      return messages.shift();
    }, close: () => new Promise(resolve => { if (ws.readyState === 3) resolve(); else { ws.once('close', resolve); ws.close(); } }) };
  };
  f.close = async () => { await host.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); };
  return f;
}
