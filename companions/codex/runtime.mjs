// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeGuardianEvent } from '../../src/lib/native-guardian.ts';
import { nativeCaCertificate } from './tls.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareNativeAccountRead, reviewNativeAccountRead, reviewNativeAccountMetadata, reviewNativeAccountPrivateEcho } from './account-read.mjs';
import { nativeAccountAuthority } from './account-authority.mjs';
import { nativeGatewayOAuthState, nativeGatewayOAuthUrl } from '../../src/lib/native-gateway-oauth.ts';
import { prepareNativeAccountAction, checkNativeAccountAction, reviewNativeAccountAction } from './account-actions.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, dirname, join, resolve, delimiter } from 'node:path';
import { prepareNativeQueryPaths } from './query.mjs';
import { prepareNativeFeedback } from './feedback.mjs';
import { reviewNativeFilesystemRead } from './filesystem-read.mjs';
import { prepareNativeFilesystemWatch, reviewNativeFilesystemChange } from './filesystem-watch.mjs';
import { prepareNativeCommand, reviewNativeCommand } from './command.mjs';
import { prepareNativeWindowsReadiness, reviewNativeWindowsReadiness } from './windows-sandbox.mjs';
import { prepareNativePluginShare, reviewNativePluginShare } from './plugin-share.mjs';
import { prepareNativePluginInstall, reviewNativePluginInstall } from './plugin-install.mjs';
import { prepareNativeMarketplace, reviewNativeMarketplace } from './marketplace.mjs';
import { prepareNativePluginRead, reviewNativePluginRead } from './plugin-read.mjs';
import { prepareNativeConfigurationRead, reviewNativeConfigurationRead } from './configuration-read.mjs';
import { prepareNativeConfigurationControl, reviewNativeConfigurationControl } from './configuration-control.mjs';
import { prepareNativeConfigurationWrite, reviewNativeConfigurationWrite, checkConfigurationWriteAuthority } from './configuration-write.mjs';
import { prepareNativeMigrationScopes, reviewNativeMigrationSources } from './migration-paths.mjs';
import { prepareNativeMigration, checkNativeMigrationAuthority, checkNativeMigrationPreimages, reviewNativeMigration, reviewSqliteRoot } from './migration.mjs';
import { nativeMigrationHistoryMarker, nativeMigrationHistoryRow } from './migration-history.mjs';
import { prepareNativeStoredThreadRead, reviewNativeStoredThreadRead, nativeStoredThreadDirectory } from './stored-thread.mjs';
import { prepareNativeThreadLifecycle, reviewNativeThreadLifecycle } from './thread-lifecycle.mjs';
import { prepareNativeThreadContent, reviewNativeThreadContent } from './thread-content.mjs';
import { nativeRuntimeVersion as version, nativeRuntimeLimits as limits, nativeUuid, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const privateConfigPrefix = 'operations/private/config/';
export async function openCodexRuntime(config) {
  if (!nativeUuid(config.runtimeId) || ![config.executable, config.home, config.workspace].every(value => typeof value === 'string' && isAbsolute(value))
    || !/^[a-f0-9]{64}$/.test(config.binarySha256)) throw new Error('Invalid private runtime configuration.');
  if (config.allowMigration === true && (typeof config.migrationHome !== 'string' || !isAbsolute(config.migrationHome))) throw new Error('Migration requires an explicit private source/target home.');
  const requestedHome = resolve(config.home), desktopHome = join(homedir(), '.codex');
  if (requestedHome === desktopHome || requestedHome.startsWith(desktopHome + '/') || requestedHome === homedir() || requestedHome === '/') throw new Error('A dedicated private runtime home is required.');
  await mkdir(requestedHome, { recursive: true, mode: 0o700 });
  const home = await realpath(requestedHome), workspace = await realpath(config.workspace), executable = await realpath(config.executable);
  if ((config.allowAgent === true || config.allowCommands === true || config.allowConfigurationControl === true || config.allowConfigurationWrite === true || config.allowMigration === true) && /[*?\[\]{}]/.test(home)) throw new Error('The permission-profile home must be an exact filesystem path.');
  const privateHome = await lstat(requestedHome);
  if (privateHome.isSymbolicLink() || home !== requestedHome || !privateHome.isDirectory() || privateHome.mode & 0o077
    || privateHome.uid !== process.getuid?.() || home === workspace || workspace.startsWith(home + '/')) throw new Error('Invalid private runtime home.');
  // The pinned importer writes home skills to CODEX_HOME's parent. Keep that
  // entire source/target home private and disjoint from the public workspace.
  let migrationHome, migrationOwner, migrationHistory, migrationHistoryOwner;
  let migrationEpoch = 'initial', migrationActive;
  if (config.allowMigration === true) {
    migrationHome = resolve(config.migrationHome); migrationOwner = await lstat(migrationHome);
    if (migrationHome !== dirname(home) || migrationHome === homedir() || migrationHome === '/' || migrationOwner.isSymbolicLink()
      || !migrationOwner.isDirectory() || migrationOwner.uid !== privateHome.uid || migrationOwner.mode & 0o077 || await realpath(migrationHome) !== migrationHome
      || workspace === migrationHome || workspace.startsWith(migrationHome + '/') || migrationHome.startsWith(workspace + '/')) throw new Error('Migration home must be the owned private Codex parent, separate from the workspace.');
    migrationHistory = join(home, '.operations-migrations'); await mkdir(migrationHistory, { recursive: true, mode: 0o700 });
    migrationHistoryOwner = await lstat(migrationHistory);
    if (migrationHistoryOwner.isSymbolicLink() || !migrationHistoryOwner.isDirectory() || migrationHistoryOwner.uid !== privateHome.uid
      || migrationHistoryOwner.mode & 0o077 || await realpath(migrationHistory) !== migrationHistory) throw new Error('Invalid private migration history directory.');
    await reviewSqliteRoot(migrationHistory, { migrationHome });
  }
  const binary = await readFile(executable);
  if (hash(binary) !== config.binarySha256) throw new Error('The configured Codex binary does not match its pin.');
  const basePath = process.env.PATH ?? '/usr/bin:/bin';
  const dispatcher = config.allowCommands === true && process.platform === 'linux' ? { directory: join(home, '.operations-dispatch'), basePath } : undefined;
  const dispatcherPath = dispatcher && join(dispatcher.directory, 'codex-linux-sandbox');
  if (dispatcher) {
    await mkdir(dispatcher.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(dispatcher.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== privateHome.uid || await realpath(dispatcher.directory) !== dispatcher.directory) throw new Error('Invalid private command dispatcher directory.');
    try { await symlink(executable, dispatcherPath); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const reviewDispatcher = async () => {
    if (!dispatcher) return;
    const info = await lstat(dispatcher.directory), link = await lstat(dispatcherPath);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== privateHome.uid || await realpath(dispatcher.directory) !== dispatcher.directory
      || !link.isSymbolicLink() || link.uid !== privateHome.uid || await realpath(dispatcherPath) !== executable) throw new Error('Private command dispatcher authority changed.');
  };
  await reviewDispatcher();
  const environment = { PATH: dispatcher ? dispatcher.directory + delimiter + basePath : basePath, LANG: 'C.UTF-8', HOME: migrationHome ?? home, CODEX_HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' };
  const ca = await nativeCaCertificate(config.caCertificate, home, privateHome.uid);
  if (ca) environment.CODEX_CA_CERTIFICATE = ca.path;
  const reported = await promisify(execFile)(executable, ['--version'], { cwd: workspace, env: environment, timeout: 5000, maxBuffer: 4096 });
  if (reported.stdout.trim() !== 'codex-cli ' + version) throw new Error('The Codex runtime version does not match the schema pin.');
  const generation = randomUUID(), binaryStat = await stat(executable);
  let lastAccount, accountEpoch = randomUUID(), owned, inspection, gatewayContext;
  const fileHash = async path => {
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) throw new Error('Invalid runtime authority file.');
      return hash(await readFile(path));
    } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
  };
  async function captureAuthority() {
    await reviewDispatcher();
    const current = await stat(executable), directory = await stat(workspace), owner = await lstat(home);
    if (current.ino !== binaryStat.ino || current.size !== binaryStat.size || current.mtimeMs !== binaryStat.mtimeMs
      || current.dev !== binaryStat.dev || owner.mode & 0o077 || owner.uid !== privateHome.uid || !owner.isDirectory()) throw new Error('Runtime authority changed.');
    if (migrationHome) {
      const root = await lstat(migrationHome), history = await lstat(migrationHistory);
      if (root.isSymbolicLink() || !root.isDirectory() || root.mode & 0o077 || root.uid !== migrationOwner.uid || root.dev !== migrationOwner.dev || root.ino !== migrationOwner.ino
        || history.isSymbolicLink() || !history.isDirectory() || history.mode & 0o077 || history.uid !== migrationHistoryOwner.uid || history.dev !== migrationHistoryOwner.dev || history.ino !== migrationHistoryOwner.ino
        || owner.dev !== privateHome.dev || owner.ino !== privateHome.ino) throw new Error('Migration root authority changed.');
    }
    const credentials = await nativeAccountAuthority(home, privateHome.uid), auth = hash(JSON.stringify(credentials));
    if (lastAccount !== undefined && lastAccount !== auth) accountEpoch = randomUUID();
    lastAccount = auth;
    const parts = [config.binarySha256, executable, home, workspace, directory.dev, directory.ino,
      await fileHash(join(home, 'config.toml')), await fileHash(join(workspace, '.codex/config.toml')), 'file', 'read-only', false, config.allowAgent === true, config.allowMetadata === true, config.allowApps === true, config.allowFeedback === true, config.allowFeedbackDiagnostics === true, config.allowFilesystemRead === true, config.allowFilesystemWrite === true, config.allowFilesystemWatch === true, config.allowSectionsRead === true, config.allowSectionsWrite === true, config.allowMcpRead === true, config.allowMcpTools === true, config.allowMcpOAuth === true, config.allowCommands === true, config.allowThreadShell === true, config.allowConfigurationRead === true, config.allowConfigurationControl === true, config.allowConfigurationWrite === true, config.allowThreadsRead === true];
    parts.push('threadsWrite', config.allowThreadsWrite === true, 'accountRead', config.allowAccountRead === true, 'accountAuth', config.allowAccountAuth === true);
    parts.push('credential-authority-v2', 'explicitGatewayOauth');
    parts.push('gatewayOAuth', config.allowGatewayOAuth === true);
    parts.push('pluginsRead', config.allowPluginsRead === true);
    if (ca) parts.push('nativeTlsCa', await nativeCaCertificate(ca.path, home, privateHome.uid));
    parts.push('marketplaces', config.allowMarketplaces === true, config.allowMarketplaces === true ? await fileHash(join(home, '.gitconfig')) : null);
    if (config.allowWindowsSandboxReadiness === true) parts.push('windows-readiness', true);
    if (config.allowPluginSharing === true) parts.push('plugin-sharing', true);
    if (config.allowPluginManagement === true) parts.push('plugin-management', true, await fileHash(join(home, '.gitconfig')), await fileHash(join(home, '.npmrc')));
    parts.push('accountActions', config.allowAccountActions === true);
    parts.push('guardianReview', config.allowGuardian === true);
    if (migrationHome) parts.push('migration', migrationHome, migrationOwner.dev, migrationOwner.ino, migrationHistory, migrationEpoch);
    const identity = { runtimeId: config.runtimeId, generation, version, configuration: hash(JSON.stringify(parts)), workspace: hash(workspace), accountEpoch };
    const nonUser = [...parts]; nonUser[6] = 'user-config';
    const migrationBasis = [...nonUser]; migrationBasis[7] = 'project-config';
    return { identity, credentials, gatewayBasis: hash(JSON.stringify([parts, owner.dev, owner.ino, credentials.auth, credentials.codex])), basis: hash(JSON.stringify([nonUser, owner.dev, owner.ino])),
      ...(migrationHome ? { migrationBasis: hash(JSON.stringify([migrationBasis, owner.dev, owner.ino])) } : {}) };
  }
  async function authority() { return (await captureAuthority()).identity; }
  await authority();
  async function start(receive, exited) {
    if (owned) throw new Error('The runtime is already owned by a connection.');
    // The named profile keeps the provider credential store outside agent tool
    // reads. Never replace it with the legacy per-thread sandbox override.
    const permissions = config.allowAgent === true || config.allowCommands === true || config.allowConfigurationControl === true || config.allowConfigurationWrite === true || migrationHome ? ['-c', 'default_permissions="operations"', '-c',
      'permissions.operations={filesystem={":root"="read",' + JSON.stringify(migrationHome ?? home) + '="deny"},network={enabled=false}}']
      : ['-c', 'sandbox_mode="read-only"'];
    const child = spawn(executable, ['-c', 'cli_auth_credentials_store="file"', '-c', 'analytics.enabled=false',
      ...(migrationHome || config.allowThreadsWrite === true ? ['-c', 'sqlite_home=' + JSON.stringify(migrationHistory ?? home)] : []),
      ...(config.allowFeedback === true ? [] : ['-c', 'feedback.enabled=false']), ...permissions, 'app-server', '--listen', 'stdio://'], { cwd: workspace, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    owned = child;
    const privateState = { child, ready: false, pending: new Map(), accountControl: false };
    inspection = privateState;
    function revokeInspection() {
      if (owned === child && migrationActive) abortMigration(migrationActive);
      if (inspection === privateState) inspection = undefined;
      for (const item of privateState.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Native configuration inspection unavailable.')); }
      privateState.pending.clear();
    }
    let buffer = Buffer.alloc(0), stopped = false;
    const finished = new Promise(resolve => { child.once('close', () => { revokeInspection(); if (owned === child) owned = undefined; exited(); resolve(); }); });
    child.on('error', () => { revokeInspection(); exited(); }); child.stdin.on('error', () => { revokeInspection(); exited(); });
    child.stderr.on('data', () => { /* Native logs can contain private inputs; do not expose them. */ });
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > limits.frame * 2) { void close(); return; }
      let end;
      while ((end = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        if (!line.length) continue;
        try {
          if (line.length > limits.frame) throw new Error();
          const frame = JSON.parse(line.toString('utf8'));
          if (typeof frame.id === 'string' && frame.id.startsWith(privateConfigPrefix)) {
            const item = privateState.pending.get(frame.id);
            if (!item || Object.hasOwn(frame, 'method') || Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error')) throw new Error();
            privateState.pending.delete(frame.id); clearTimeout(item.timer);
            if (Object.hasOwn(frame, 'error')) item.reject(new Error('Native configuration inspection failed.'));
            else item.resolve(frame.result);
          } else receive(frame);
        }
        catch { void close(); return; }
      }
    });
    async function close() {
      if (!stopped) {
        revokeInspection();
        stopped = true; child.stdin.end(); child.kill('SIGTERM');
        const kill = setTimeout(() => child.kill('SIGKILL'), 1500);
        try { await finished; } finally { clearTimeout(kill); buffer.fill(0); }
      } else await finished;
    }
    return { send(frame) {
      if (typeof frame.id === 'string' && frame.id.startsWith(privateConfigPrefix)) throw new Error('Reserved native request ID.');
      const bytes = JSON.stringify(frame) + '\n';
      if (stopped || child.stdin.destroyed || Buffer.byteLength(bytes) > limits.frame || child.stdin.writableLength > limits.frame) throw new Error('Native input unavailable.');
      child.stdin.write(bytes);
      if (frame.method === 'initialized') privateState.ready = true;
      if (['account/login/start', 'account/login/cancel', 'account/logout'].includes(frame.method)) privateState.accountControl = true;
    }, close };
  }
  async function privateRequest(method, params) {
    const state = inspection;
    const granted = method === 'account/read' ? config.allowAccountRead === true || config.allowAccountActions === true || config.allowPluginSharing === true : method === 'account/gatewayOAuth/read' ? config.allowGatewayOAuth === true
      : method === 'config/read' ? config.allowConfigurationWrite === true || config.allowGatewayOAuth === true || config.allowMarketplaces === true || config.allowPluginsRead === true || config.allowPluginManagement === true || config.allowPluginSharing === true || !!migrationHome
      : method === 'plugin/read' ? config.allowPluginManagement === true || config.allowPluginSharing === true
      : method === 'plugin/share/list' ? config.allowPluginSharing === true
      : method === 'thread/read' && (config.allowThreadsRead === true || config.allowThreadsWrite === true)
        || ['thread/loaded/list', 'thread/goal/get'].includes(method) && config.allowThreadsWrite === true;
    if (!granted || !state?.ready || state.child !== owned || state.child.stdin.destroyed) throw new Error('Native configuration inspection unavailable.');
    if (state.pending.size) throw new Error('Native configuration inspection already pending.');
    return new Promise((resolve, reject) => {
      const id = privateConfigPrefix + randomUUID();
      const timer = setTimeout(() => { state.pending.delete(id); reject(new Error('Native configuration inspection timed out.')); }, 15000);
      state.pending.set(id, { resolve, reject, timer });
      try {
        if (state.child.stdin.writableLength > limits.frame) throw new Error();
        state.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      } catch { state.pending.delete(id); clearTimeout(timer); reject(new Error('Native configuration inspection unavailable.')); }
    });
  }
  async function inspectConfiguration(cwd = null) {
    if (cwd !== null && (typeof cwd !== 'string' || !isAbsolute(cwd)
      || !(cwd === workspace || cwd.startsWith(workspace + '/') || migrationHome && (cwd === migrationHome || cwd.startsWith(migrationHome + '/')))
      || !migrationHome && config.allowPluginsRead !== true && config.allowPluginManagement !== true)) throw new Error('Private configuration scope is not granted.');
    return privateRequest('config/read', { includeLayers: true, cwd });
  }
  function requireMigration(context) { if (!migrationHome || migrationActive !== context || context.closed) throw new Error('Unowned migration context.'); }
  function abortMigration(context) {
    if (migrationActive !== context) return;
    if (context.dispatched && !context.verified && context.method === 'externalAgentConfig/import') migrationEpoch = randomUUID();
    context.closed = true; migrationActive = undefined;
  }
  const writeContext = { workspace, home, capture: captureAuthority, inspect: inspectConfiguration };
  const pluginInstallContext = { ...writeContext, read: params => privateRequest('plugin/read', params) };
  const pluginShareContext = { ...pluginInstallContext, account: () => privateRequest('account/read', { refreshToken: false }), list: () => privateRequest('plugin/share/list', {}) };
  const threadWriteContext = { workspace, home, sqliteRoot: migrationHistory ?? home,
    inspect: threadId => privateRequest('thread/read', { threadId, includeTurns: false }),
    inspectGoal: threadId => privateRequest('thread/goal/get', { threadId }),
    async loaded() {
      const page = await privateRequest('thread/loaded/list', { limit: 64 });
      if (!page || page.nextCursor != null || !Array.isArray(page.data)) throw new Error('Native loaded-thread inventory requires more than one page.');
      return page.data;
    } };
  const accountContext = { home, account: () => privateRequest("account/read", { refreshToken: false }) };
  const actionContext = { ...accountContext, authority };
  const actionGrant = () => { if (config.allowAccountActions !== true) throw new Error('Account actions are not granted.'); };
  async function checkGateway(context) {
    if (config.allowGatewayOAuth !== true || gatewayContext !== context || context.closed) throw new Error('Gateway sign-in is not granted or owned.');
    const current = await captureAuthority();
    if (current.gatewayBasis !== context.before.gatewayBasis) throw new Error('Primary account or gateway configuration changed.');
    return current;
  }
  return { authority, start, inspectConfiguration,
    prepareAccountAction(method, input) { actionGrant(); return prepareNativeAccountAction(method, input, actionContext); },
    checkAccountAction(plan) { actionGrant(); return checkNativeAccountAction(plan, actionContext); },
    reviewAccountAction(plan, result) { actionGrant(); return reviewNativeAccountAction(plan, result, actionContext); },
    async prepareGatewayOAuth() {
      if (config.allowGatewayOAuth !== true || gatewayContext) throw new Error('Gateway sign-in is not granted or busy.');
      const context = { before: await captureAuthority() }; gatewayContext = context;
      try {
        const state = nativeGatewayOAuthState(await privateRequest('account/gatewayOAuth/read', null));
        if (!state.required || state.status === 'started') throw new Error('The selected provider has no available gateway sign-in.');
        const effective = await inspectConfiguration();
        const provider = effective?.config?.model_providers?.[state.providerId];
        context.providerId = state.providerId;
        context.authorizationUrl = nativeGatewayOAuthUrl(provider?.gateway_oauth?.authorization_url);
        const current = await checkGateway(context);
        if (!sameNativeIdentity(context.before.identity, current.identity)) throw new Error('Gateway credentials changed during preparation.');
        return context;
      } catch (error) { if (gatewayContext === context) gatewayContext = undefined; throw error; }
    },
    async gatewayOAuthAuthority(context) { return (await checkGateway(context)).identity; },
    async reviewGatewayOAuthNotice(context, value) {
      await checkGateway(context);
      const authUrl = nativeGatewayOAuthUrl(value), expected = new URL(context.authorizationUrl), actual = new URL(authUrl);
      if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) throw new Error('Gateway handoff does not match the configured provider.');
      await reviewNativeAccountPrivateEcho({ authUrl }, home); await checkGateway(context); return authUrl;
    },
    async reviewGatewayOAuth(context) {
      await checkGateway(context);
      const state = nativeGatewayOAuthState(await privateRequest('account/gatewayOAuth/read', null));
      const current = await checkGateway(context);
      if (!state.required || state.providerId !== context.providerId || state.status !== 'succeeded') throw new Error('Native gateway credentials were not confirmed.');
      context.verified = current.identity; return current.identity;
    },
    async finishGatewayOAuth(context, cancelled) {
      try {
        const current = await checkGateway(context);
        if (cancelled ? current.credentials.gateway !== context.before.credentials.gateway : !context.verified || !sameNativeIdentity(context.verified, current.identity))
          throw new Error('Gateway credentials changed outside their confirmed completion.');
      } finally { context.closed = true; if (gatewayContext === context) gatewayContext = undefined; }
    },
    async prepareGuardianDenial(denial) {
      if (config.allowAgent !== true || config.allowGuardian !== true) throw new Error('Guardian review is not granted.');
      await reviewNativeAccountPrivateEcho(denial, home);
      const cwd = denial.action.cwd;
      if (typeof cwd === 'string') await nativeStoredThreadDirectory(cwd.startsWith('file:') ? fileURLToPath(cwd) : cwd, { workspace, home });
      const event = nativeGuardianEvent(denial, path => {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) { new URL(path); return path; }
        if (!isAbsolute(path)) throw new Error('Guardian permission path must be absolute.');
        return pathToFileURL(path).href;
      });
      if (Buffer.byteLength(JSON.stringify(event), 'utf8') > 61440) throw new Error('Guardian event exceeds the bounded native frame.');
      return event;
    },
    reviewAccountMetadata: result => {
      if (config.allowAccountAuth !== true) throw new Error('Account authentication is not granted.');
      return reviewNativeAccountMetadata(result, home);
    },
    async accountUpdateIsUnchanged(expected) {
      // The SDK fills its account cache lazily on the first read and emits
      // account/updated for that fill. Under the read grant, ignore this hint
      // only while the same file-backed authority remains pinned and this
      // child has never dispatched an account login/logout control.
      return (config.allowAccountRead === true || config.allowAccountAuth === true || config.allowAccountActions === true || config.allowMarketplaces === true || config.allowPluginsRead === true || config.allowPluginManagement === true || config.allowPluginSharing === true) && inspection?.child === owned && !inspection.accountControl
        && sameNativeIdentity(expected, await authority());
    },
    prepareAccountRead: (method, input) => {
      if (config.allowAccountRead !== true) throw new Error("Account reads are not granted.");
      return prepareNativeAccountRead(method, input, accountContext);
    },
    reviewAccountRead: (plan, result) => {
      if (config.allowAccountRead !== true) throw new Error("Account reads are not granted.");
      return reviewNativeAccountRead(plan, result, accountContext);
    },
    prepareThreadContent: (method, input) => {
      if (config.allowThreadsWrite !== true) throw new Error('Thread content writes are not granted.');
      return prepareNativeThreadContent(method, input, threadWriteContext);
    },
    reviewThreadContent: (plan, result) => {
      if (config.allowThreadsWrite !== true) throw new Error('Thread content writes are not granted.');
      return reviewNativeThreadContent(plan, result, threadWriteContext);
    },
    inspectThreadGoal: threadId => {
      if (config.allowThreadsWrite !== true) throw new Error('Thread goal inspection is not granted.');
      return threadWriteContext.inspectGoal(threadId);
    },
    prepareThreadLifecycle: (method, input) => {
      if (config.allowThreadsWrite !== true) throw new Error('Thread lifecycle writes are not granted.');
      return prepareNativeThreadLifecycle(method, input, threadWriteContext);
    },
    reviewThreadLifecycle: (plan, result) => {
      if (config.allowThreadsWrite !== true) throw new Error('Thread lifecycle writes are not granted.');
      return reviewNativeThreadLifecycle(plan, result, threadWriteContext);
    },
    async prepareMigration(method, input) {
      if (!migrationHome || migrationActive) throw new Error('Migration is unavailable or busy.');
      const reservation = {}; migrationActive = reservation;
      try {
        const context = await prepareNativeMigration(method, input, { workspace, home, migrationHome, capture: captureAuthority,
          inspect: inspectConfiguration, historyMarker: () => nativeMigrationHistoryMarker(migrationHistory),
          historyRow: id => nativeMigrationHistoryRow(migrationHistory, id) });
        if (migrationActive !== reservation) throw new Error('Migration preparation lost its owner.');
        migrationActive = context; return context;
      } catch (error) { if (migrationActive === reservation) migrationActive = undefined; throw error; }
    },
    async dispatchMigration(context) {
      requireMigration(context); if (context.dispatched) throw new Error('Migration was already dispatched.');
      await checkNativeMigrationPreimages(context); requireMigration(context); context.dispatched = true;
      return context.method === 'externalAgentConfig/import/readHistories' ? null : context.params;
    },
    async reviewMigration(context, result, completion) {
      requireMigration(context); if (!context.dispatched || context.verified) throw new Error('Invalid migration review phase.');
      try {
        const verified = await reviewNativeMigration(context, result, completion); requireMigration(context);
        if (context.method === 'externalAgentConfig/import' && verified.effects.length) migrationEpoch = randomUUID();
        const after = await captureAuthority();
        if (!sameNativeIdentity(context.before.identity, { ...after.identity, configuration: context.before.identity.configuration })) throw new Error('Migration identity changed outside configuration.');
        context.verified = true; context.after = after;
        return { ...verified, identity: after.identity };
      } catch (error) { abortMigration(context); throw error; }
    },
    async migrationAuthority(context) {
      requireMigration(context); const current = await captureAuthority();
      if (context.verified) { if (!sameNativeIdentity(context.after.identity, current.identity)) throw new Error('Verified migration authority changed.'); }
      else checkNativeMigrationAuthority(context, current);
      return current.identity;
    },
    finishMigration(context) { requireMigration(context); if (!context.verified) throw new Error('Migration has not been verified.'); context.closed = true; migrationActive = undefined; },
    abortMigration,
    async prepareMigrationScopes(method, input) {
      if (!migrationHome) throw new Error('Migration is not granted.');
      const before = await captureAuthority(), plan = await prepareNativeMigrationScopes(method, input, { workspace, home, migrationHome });
      const after = await captureAuthority();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Migration authority changed during scope inspection.');
      return { ...plan, before };
    },
    reviewMigrationSources: reviewNativeMigrationSources,
    prepareConfigurationWrite: (method, params) => { if (config.allowConfigurationWrite !== true) throw new Error('Configuration writes are not granted.'); return prepareNativeConfigurationWrite(method, params, writeContext); },
    reviewConfigurationWrite: (context, result) => { if (config.allowConfigurationWrite !== true) throw new Error('Configuration writes are not granted.'); return reviewNativeConfigurationWrite(context, result, writeContext); },
    async configurationWriteAuthority(context) { const current = await captureAuthority(); checkConfigurationWriteAuthority(context, current); return current.identity; },
    prepareStoredThreadRead: (method, params) => {
      if (config.allowThreadsRead !== true) throw new Error('Stored-thread reads are not granted.');
      return prepareNativeStoredThreadRead(method, params, { workspace, home, inspect: threadId => privateRequest('thread/read', { threadId, includeTurns: false }) });
    },
    reviewStoredThreadRead: (method, params, result) => {
      if (config.allowThreadsRead !== true) throw new Error('Stored-thread reads are not granted.');
      return reviewNativeStoredThreadRead(method, params, result, { workspace, home, inspect: threadId => privateRequest('thread/read', { threadId, includeTurns: false }) });
    },
    prepareQuery: (method, params) => prepareNativeQueryPaths(method, params, workspace, home, [executable]),
    prepareConfigurationControl: (method, params) => prepareNativeConfigurationControl(method, params, workspace, home),
    reviewConfigurationControl: (method, params, value) => reviewNativeConfigurationControl(method, params, value, workspace, home),
    prepareWindowsReadiness: input => { if (config.allowWindowsSandboxReadiness !== true) throw new Error('Windows readiness is not granted.'); return prepareNativeWindowsReadiness(input, { authority }); },
    reviewWindowsReadiness: (plan, result) => { if (config.allowWindowsSandboxReadiness !== true) throw new Error('Windows readiness is not granted.'); return reviewNativeWindowsReadiness(plan, result, { authority }); },
    preparePluginShare: (method, params) => { if (config.allowPluginSharing !== true) throw new Error('Plugin sharing is not granted.'); return prepareNativePluginShare(method, params, pluginShareContext); },
    reviewPluginShare: (plan, result) => { if (config.allowPluginSharing !== true) throw new Error('Plugin sharing is not granted.'); return reviewNativePluginShare(plan, result, pluginShareContext); },
    preparePluginInstall: (method, params) => { if (config.allowPluginManagement !== true) throw new Error('Plugin management is not granted.'); return prepareNativePluginInstall(method, params, pluginInstallContext); },
    reviewPluginInstall: (plan, result) => { if (config.allowPluginManagement !== true) throw new Error('Plugin management is not granted.'); return reviewNativePluginInstall(plan, result, pluginInstallContext); },
    prepareMarketplace: (method, params) => { if (config.allowMarketplaces !== true) throw new Error('Marketplace management is not granted.'); return prepareNativeMarketplace(method, params, writeContext); },
    reviewMarketplace: (plan, result) => { if (config.allowMarketplaces !== true) throw new Error('Marketplace management is not granted.'); return reviewNativeMarketplace(plan, result, writeContext); },
    preparePluginRead: (method, params) => { if (config.allowPluginsRead !== true) throw new Error('Plugin reads are not granted.'); return prepareNativePluginRead(method, params, { workspace, home, inspect: inspectConfiguration }); },
    reviewPluginRead: (plan, result) => { if (config.allowPluginsRead !== true) throw new Error('Plugin reads are not granted.'); return reviewNativePluginRead(plan, result, { workspace, home }); },
    prepareConfigurationRead: (method, params) => prepareNativeConfigurationRead(method, params, workspace, home), reviewConfigurationRead: reviewNativeConfigurationRead,
    prepareCommand: params => prepareNativeCommand(params, workspace, home, dispatcher), reviewCommand: root => reviewNativeCommand(root, workspace, home),
    prepareWatch: params => prepareNativeFilesystemWatch(params, workspace, home),
    reviewWatchChange: (root, paths) => reviewNativeFilesystemChange(root, paths, workspace, home),
    reviewQueryResult: (method, params, result) => reviewNativeFilesystemRead(method, params, result, workspace, home),
    prepareFeedback: (params, pairingKey) => prepareNativeFeedback(params, { workspace, home, pairingKey, allowDiagnostics: config.allowFeedbackDiagnostics === true }) };
}
