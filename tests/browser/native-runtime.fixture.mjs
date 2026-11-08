// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { seedNativeWindowsSandbox } from '../native-windows-sandbox.fixture.mjs';
import { seedNativePluginSharing, ownedSharedPluginId } from '../native-plugin-share-sdk.fixture.mjs';
import { seedNativePluginInstallation } from '../native-plugin-install-sdk.fixture.mjs';
import { seedNativeMarketplaceAction } from '../native-marketplace-sdk.fixture.mjs';
import { nativePluginReadFixture } from '../native-plugin-read.fixture.mjs';
import { seedNativePluginBackend } from '../native-plugin-sdk.fixture.mjs';
import { nativeGuardianFixture } from '../native-guardian.fixture.mjs';
import { nativeTurnControlFixture, seedNativeTurnProvider } from '../native-turn-control.fixture.mjs';
import { seedNativeGateway, nativeGatewayFixture } from '../native-gateway-oauth.fixture.mjs';
import { nativeAccountActionsFixture } from '../native-account-actions.fixture.mjs';
import { nativeAccountAuthFixture } from '../native-account-auth.fixture.mjs';
import { seedNativeAccountBackend } from '../native-account-read-sdk.fixture.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nativeMigrationStateDatabase } from '../../companions/codex/migration-history.mjs';
import { nativeHostFixture } from '../native-runtime.fixture.mjs';
import { nativeWatchTransportFixture } from '../native-watch-transport.fixture.mjs';
import { nativeMcpToolFixture, seedNativeMcpTool } from '../native-mcp-tool.fixture.mjs';
import { nativeCommandFixture } from '../native-command.fixture.mjs';
import { nativeMcpOAuthFixture } from '../native-mcp-oauth.fixture.mjs';
import { nativeMcpOAuthServer } from '../native-mcp-oauth-server.fixture.mjs';
import { nativeMcpReadFixture, seedNativeMcpRead } from '../native-mcp-read.fixture.mjs';
import { nativeSectionsFixture } from '../native-sections.fixture.mjs';
import { nativeAgentFixture } from '../native-agent.fixture.mjs';
import { nativeThreadShellFixture, seedNativeShellProvider } from '../native-thread-shell.fixture.mjs';
import { nativeConfigurationControlFixture, seedNativeConfigurationControl } from '../native-configuration-control.fixture.mjs';
import { nativeConfigurationReadFixture, seedNativeConfigurationRead } from '../native-configuration-read.fixture.mjs';
import { nativeStoredThreadSdkFixture } from '../native-stored-thread-sdk.fixture.mjs';
import { nativeStoredThreadFixture } from '../native-stored-thread.fixture.mjs';
import { nativeQueryFixture, nativeFilesystemBytes } from '../native-query.fixture.mjs';
import { nativeFeedbackFixture } from '../native-feedback.fixture.mjs';
import { nativeFilesystemWriteFixture, seedNativeFilesystemWrites, nativeFilesystemMutationObserved } from '../native-filesystem-write.fixture.mjs';
import { nativeStandaloneMethods } from '../../src/lib/native-runtime-contract.ts';
import { openCodexRuntime } from '../../companions/codex/runtime.mjs';

class MissingNativeQualificationPin extends Error {
  constructor(missing) {
    super('Real native browser fixtures require the pinned Codex binary and SHA-256. Missing: ' + missing.join(', '));
    this.missing = missing;
  }
}

/** Test control stays on the isolated harness origin. HTTPS, CORS, WSS and the
 * companion handler are real; only the default stdio peer is synthetic. */
export function createNativeBrowserEndpoint() {
  const entries = new Map();
  async function remove(entry) { await entry.fixture.close(); await entry.oauth?.close(); await entry.provider?.close(); if (entry.directory) await rm(entry.directory, { recursive: true, force: true }); }
  async function handle(request, response, match) {
    const [, id, action] = match;
    const answer = value => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (action === 'create' && request.method === 'POST') {
      if (entries.has(id)) throw new Error();
      const parts = []; for await (const part of request) { parts.push(part); if (Buffer.concat(parts).length > 1024) throw new Error(); }
      const input = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
      const applicationOrigin = 'http://' + request.headers.host;
      let runtime, directory, provider, oauth, storedSeed; const observation = { starts: 0, stops: 0, methods: [], responseShapes: [], notifications: [], authorityChanges: [] };
      if (input.windowsReadiness === true && input.real !== true) throw new Error('Windows readiness requires the actual SDK fixture.');
      if (input.pluginSharing === true && input.real !== true) throw new Error('Plugin sharing requires the actual SDK fixture.');
      if (input.pluginManagement === true && input.real !== true) throw new Error('Plugin management requires the actual SDK fixture.');
      if (input.real === true) {
        // Real feedback tests may only exercise a configuration-denied upload.
        // Positive delivery stays on the owned synthetic stdio peer.
        if (input.feedback === true && input.denyFeedback !== true) throw new Error();
        const missing = ['OPERATIONS_CODEX_QUALIFICATION_BINARY', 'OPERATIONS_CODEX_QUALIFICATION_SHA256'].filter(name => !process.env[name]);
        if (missing.length) throw new MissingNativeQualificationPin(missing);
        directory = await mkdtemp(join(tmpdir(), 'operations-native-browser-'));
        const home = input.migration === true ? join(directory, 'private', 'codex') : join(directory, 'home'), workspace = join(directory, 'workspace');
        if (input.migration === true) await mkdir(dirname(home), { mode: 0o700 });
        await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
        if (input.migration === true) {
          const source = join(dirname(home), '.claude'); await mkdir(join(source, 'projects/owned-project'), { recursive: true });
          await writeFile(join(source, 'CLAUDE.md'), 'Owned browser migration instructions.\n');
          await writeFile(join(source, 'settings.json'), JSON.stringify({ env: { OWNED_BROWSER_SECRET: 'OWNED_MIGRATION_PROVIDER_SECRET_2486', OWNED_FLAG: '1' } }));
          const lines = ['user', 'assistant'].map(type => ({ type, cwd: workspace, timestamp: new Date().toISOString(), message: { content: 'OWNED_MIGRATION_PROVIDER_SECRET_2486 private session' } }));
          await writeFile(join(source, 'projects/owned-project', randomUUID() + '.jsonl'), lines.map(row => JSON.stringify(row)).join('\n') + '\n');
        }
        if (input.filesystemRead === true) {
          await writeFile(join(workspace, 'fixture.txt'), nativeFilesystemBytes);
          await writeFile(join(workspace, 'back\\slash.txt'), 'Owned filename fixture.');
        }
        if (input.filesystemWrite === true) await seedNativeFilesystemWrites(workspace);
        if (input.filesystemWatch === true) await writeFile(join(workspace, 'watched.txt'), 'Owned browser watch fixture.');
        if (input.accountActions === true || input.accountRead === true || input.accountAuth === true || input.gatewayOAuth === true) { provider = await seedNativeAccountBackend(home); if (input.accountAuth === true || input.gatewayOAuth === true) await rm(join(home, 'auth.json')); }
        if (input.pluginsRead === true || input.marketplaces === true) provider = await seedNativePluginBackend(home, workspace);
        if (input.windowsReadiness === true) await seedNativeWindowsSandbox(home);
        if (input.pluginSharing === true) {
          provider = await seedNativePluginSharing(home, workspace, { created: input.lifecycleMethod !== 'plugin/share/save' });
          const config = join(home, 'config.toml'); await writeFile(config, (await readFile(config, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
          if (input.lifecycleMethod === 'plugin/share/delete') {
            await mkdir(join(home, '.tmp'), { recursive: true });
            await writeFile(join(home, '.tmp/plugin-share-local-paths-v1.json'), JSON.stringify({ localPluginPathsByRemotePluginId: { [ownedSharedPluginId]: join(workspace, 'owned-plugin') } }));
          }
        }
        if (input.pluginManagement === true) {
          provider = await seedNativePluginInstallation(home, workspace);
          const config = join(home, 'config.toml'); await writeFile(config, (await readFile(config, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
          if (input.lifecycleMethod === 'plugin/uninstall') {
            const cached = join(home, 'plugins/cache/owned-market/owned-plugin/1.0.0/.codex-plugin'); await mkdir(cached, { recursive: true });
            await writeFile(join(cached, 'plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '1.0.0' }));
            await appendFile(config, '\n[plugins.\"owned-plugin@owned-market\"]\nenabled=true\n');
          }
        }
        if (input.marketplaces === true) await seedNativeMarketplaceAction(home, workspace, input.lifecycleMethod);
        if (input.gatewayOAuth === true) await seedNativeGateway({ home, backend: provider });
        if (input.mcpRead === true) await seedNativeMcpRead(home);
        if (input.mcpTools === true) provider = await seedNativeMcpTool(home);
        if (input.threadsRead === true || input.threadsWrite === true) {
          const seed = await nativeStoredThreadSdkFixture({ home, workspace });
          try { storedSeed = await seed.seed(); if (input.lifecycleMethod === 'thread/unarchive') await seed.call('thread/archive', { threadId: storedSeed.threadId }); } finally { await seed.close(); }
          provider = await seedNativeShellProvider(home); await appendFile(join(home, 'config.toml'), '\n[features]\ngoals=true\n');
        }
        if (input.turnControls === true || input.turnWork === true || input.guardian === true) provider = await seedNativeTurnProvider(home);
        if (input.threadShell === true && !provider) provider = await seedNativeShellProvider(home);
        if (input.configurationRead === true || input.configurationControl === true || input.configurationWrite === true) await seedNativeConfigurationRead(home, workspace);
        if (input.configurationControl === true) await seedNativeConfigurationControl(workspace);
        if (input.mcpOAuth === true) oauth = await nativeMcpOAuthServer(home, { prefix: provider ? await readFile(join(home, 'config.toml'), 'utf8') : '' });
        if (input.denyFeedback === true) await writeFile(join(home, 'config.toml'), '[feedback]\nenabled = false\n', { mode: 0o600 });
        const real = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
          binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace,
          ...(input.pluginManagement === true || input.pluginSharing === true ? { caCertificate: provider.caCertificate } : {}),
          ...(input.migration === true ? { migrationHome: dirname(home) } : {}),
          allowMigration: input.migration === true, allowAgent: input.agent === true, allowGuardian: input.guardian === true, allowMetadata: input.metadata === true, allowApps: input.apps === true, allowFeedback: input.feedback === true, allowFilesystemRead: input.filesystemRead === true, allowFilesystemWrite: input.filesystemWrite === true, allowFilesystemWatch: input.filesystemWatch === true, allowSectionsRead: input.sectionsRead === true, allowSectionsWrite: input.sectionsWrite === true, allowMcpRead: input.mcpRead === true, allowCommands: input.commands === true, allowThreadShell: input.threadShell === true, allowAccountAuth: input.accountAuth === true, allowGatewayOAuth: input.gatewayOAuth === true, allowAccountActions: input.accountActions === true, allowAccountRead: input.accountRead === true, allowThreadsRead: input.threadsRead === true, allowThreadsWrite: input.threadsWrite === true, allowMarketplaces: input.marketplaces === true, allowPluginManagement: input.pluginManagement === true, allowPluginSharing: input.pluginSharing === true, allowWindowsSandboxReadiness: input.windowsReadiness === true, allowPluginsRead: input.pluginsRead === true, allowConfigurationRead: input.configurationRead === true, allowConfigurationControl: input.configurationControl === true, allowConfigurationWrite: input.configurationWrite === true, allowMcpOAuth: input.mcpOAuth === true, allowMcpTools: input.mcpTools === true });
        let previous;
        runtime = { async authority() {
          const current = await real.authority();
          if (previous) { const changed = Object.keys(current).filter(key => current[key] !== previous[key]); if (changed.length) observation.authorityChanges.push(changed); }
          previous = current; return current;
        }, prepareMigration: real.prepareMigration, dispatchMigration: real.dispatchMigration, reviewMigration: real.reviewMigration,
        migrationAuthority: real.migrationAuthority, finishMigration: real.finishMigration, abortMigration: real.abortMigration,
        prepareGuardianDenial: real.prepareGuardianDenial, prepareAccountAction: real.prepareAccountAction, checkAccountAction: real.checkAccountAction, reviewAccountAction: real.reviewAccountAction,
        prepareGatewayOAuth: real.prepareGatewayOAuth, gatewayOAuthAuthority: real.gatewayOAuthAuthority, reviewGatewayOAuth: real.reviewGatewayOAuth, reviewGatewayOAuthNotice: real.reviewGatewayOAuthNotice, finishGatewayOAuth: real.finishGatewayOAuth,
        accountUpdateIsUnchanged: real.accountUpdateIsUnchanged, reviewAccountMetadata: real.reviewAccountMetadata, prepareAccountRead: real.prepareAccountRead, reviewAccountRead: real.reviewAccountRead,
        prepareThreadContent: real.prepareThreadContent, reviewThreadContent: real.reviewThreadContent, inspectThreadGoal: real.inspectThreadGoal,
        prepareThreadLifecycle: real.prepareThreadLifecycle, reviewThreadLifecycle: real.reviewThreadLifecycle,
        prepareStoredThreadRead: real.prepareStoredThreadRead, reviewStoredThreadRead: real.reviewStoredThreadRead,
        prepareConfigurationWrite: real.prepareConfigurationWrite, reviewConfigurationWrite: real.reviewConfigurationWrite, configurationWriteAuthority: real.configurationWriteAuthority,
        prepareWindowsReadiness: real.prepareWindowsReadiness, reviewWindowsReadiness: real.reviewWindowsReadiness,
        preparePluginShare: real.preparePluginShare, reviewPluginShare: real.reviewPluginShare,
        preparePluginInstall: real.preparePluginInstall, reviewPluginInstall: real.reviewPluginInstall,
        prepareMarketplace: real.prepareMarketplace, reviewMarketplace: real.reviewMarketplace,
        preparePluginRead: real.preparePluginRead, reviewPluginRead: real.reviewPluginRead,
        prepareConfigurationControl: real.prepareConfigurationControl, reviewConfigurationControl: real.reviewConfigurationControl, prepareConfigurationRead: real.prepareConfigurationRead, reviewConfigurationRead: real.reviewConfigurationRead, prepareCommand: real.prepareCommand, reviewCommand: real.reviewCommand, prepareQuery: real.prepareQuery, prepareFeedback: real.prepareFeedback, reviewQueryResult: real.reviewQueryResult,
        prepareWatch: real.prepareWatch, reviewWatchChange: real.reviewWatchChange, async start(receive, exited) {
          observation.starts++; const pending = new Map();
          const child = await real.start(frame => {
            const method = pending.get(frame.id);
            if (['initialize', 'account/read', 'feedback/upload', ...nativeStandaloneMethods].includes(method)) {
              pending.delete(frame.id); const result = frame.result;
              observation.responseShapes.push({ method, fields: result && typeof result === 'object' ? Object.keys(result) : [],
                accountAbsent: !result || !Object.hasOwn(result, 'account'), accountIsNull: result?.account === null,
                requiresOpenaiAuthType: typeof result?.requiresOpenaiAuth, errorCode: frame.error?.code });
            } else if (frame.method && observation.notifications.length < 64) observation.notifications.push(frame.method);
            receive(frame);
          }, exited); let closed = false;
          return { send(frame) { if (input.pluginManagement === true && frame.method === 'plugin/reconcile') provider.installation.installed = true; observation.methods.push(frame.method); if (frame.id !== undefined) pending.set(frame.id, frame.method); child.send(frame); }, async close() {
            await child.close(); if (!closed) { closed = true; observation.stops++; }
          } };
        } };
      }
      const fixtureFactory = !runtime && input.pluginsRead === true ? nativePluginReadFixture : !runtime && input.guardian === true ? nativeGuardianFixture : !runtime && input.turnControls === true ? nativeTurnControlFixture : !runtime && input.accountActions === true ? nativeAccountActionsFixture : !runtime && input.gatewayOAuth === true ? nativeGatewayFixture : !runtime && input.accountAuth === true ? nativeAccountAuthFixture : !runtime && input.threadsRead === true ? nativeStoredThreadFixture : !runtime && input.configurationControl === true ? nativeConfigurationControlFixture : !runtime && input.configurationRead === true ? nativeConfigurationReadFixture : !runtime && input.threadShell === true ? nativeThreadShellFixture : !runtime && input.commands === true ? nativeCommandFixture : !runtime && input.mcpOAuth === true ? nativeMcpOAuthFixture : !runtime && input.mcpTools === true ? nativeMcpToolFixture : !runtime && input.mcpRead === true ? nativeMcpReadFixture : !runtime && (input.sectionsRead === true || input.sectionsWrite === true) ? nativeSectionsFixture : !runtime && input.filesystemWatch === true ? nativeWatchTransportFixture : !runtime && input.filesystemWrite === true ? nativeFilesystemWriteFixture : !runtime && input.feedback === true ? nativeFeedbackFixture : !runtime && (input.metadata === true || input.apps === true || input.filesystemRead === true) ? nativeQueryFixture : input.agent === true && !runtime ? nativeAgentFixture : nativeHostFixture;
      const fixture = await fixtureFactory({ applicationOrigin, autoFinishShell: input.holdShell !== true, autoTerminate: true, echoCommandInput: input.commands === true,
        ...(input.wrongOrigin ? { allowedOrigins: ['https://foreign.test'] } : {}), ...(runtime ? { runtime } : {}), ...(!runtime && input.mcpTools === true ? { account: null, requiresOpenaiAuth: false } : {}), allowMigration: input.migration === true, allowAgent: input.agent === true, allowGuardian: input.guardian === true, allowMetadata: input.metadata === true, allowApps: input.apps === true, allowFeedback: input.feedback === true, allowFilesystemRead: input.filesystemRead === true, allowFilesystemWrite: input.filesystemWrite === true, allowFilesystemWatch: input.filesystemWatch === true, allowSectionsRead: input.sectionsRead === true, allowSectionsWrite: input.sectionsWrite === true, allowMcpRead: input.mcpRead === true, allowCommands: input.commands === true, allowThreadShell: input.threadShell === true, allowAccountAuth: input.accountAuth === true, allowGatewayOAuth: input.gatewayOAuth === true, allowAccountActions: input.accountActions === true, allowAccountRead: input.accountRead === true, allowThreadsRead: input.threadsRead === true, allowThreadsWrite: input.threadsWrite === true, allowMarketplaces: input.marketplaces === true, allowPluginManagement: input.pluginManagement === true, allowPluginSharing: input.pluginSharing === true, allowWindowsSandboxReadiness: input.windowsReadiness === true, allowPluginsRead: input.pluginsRead === true, allowConfigurationRead: input.configurationRead === true, allowConfigurationControl: input.configurationControl === true, allowConfigurationWrite: input.configurationWrite === true, allowMcpOAuth: input.mcpOAuth === true, allowMcpTools: input.mcpTools === true });
      entries.set(id, { fixture, directory, observation, provider, oauth, real: !!runtime, marketplaces: input.marketplaces === true, pluginManagement: input.pluginManagement === true, pluginSharing: input.pluginSharing === true, migration: input.migration === true,
        home: directory ? input.migration === true ? join(directory, 'private/codex') : join(directory, 'home') : fixture.home,
        workspace: directory ? join(directory, 'workspace') : fixture.workspace });
      return answer({ host: fixture.publicOrigin, pairingKey: fixture.key, real: !!runtime,
        ...(input.pluginSharing === true ? { pluginSourcePath: join(directory, 'workspace/owned-plugin'), sharedPluginId: ownedSharedPluginId } : {}),
        ...(input.marketplaces === true ? { marketplaceSource: join(directory, 'workspace/local-market') } : {}),
        ...(input.pluginsRead === true || input.pluginManagement === true ? { pluginMarketplacePath: provider?.marketplacePath ?? fixture.backend.marketplacePath, pluginWorkspace: directory ? join(directory, 'workspace') : fixture.workspace } : {}),
        ...(input.threadsRead === true || input.threadsWrite === true ? { storedThreadId: storedSeed?.threadId ?? fixture.seed.threadId } : {}) });
    }
    const entry = entries.get(id); if (!entry) throw new Error();
    if (action === 'seed-migration-history' && request.method === 'POST' && entry.real && entry.migration) {
      const database = new DatabaseSync(join(entry.home, '.operations-migrations', nativeMigrationStateDatabase));
      try { database.prepare('INSERT INTO external_agent_config_imports (import_id, provider_id, completed_at_ms, successes, failures) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(), 'owned-browser-seed', Date.now(), JSON.stringify([{ item_type: 'SESSIONS', title: 'OWNED_MIGRATION_PROVIDER_SECRET_2486' }]),
        JSON.stringify([{ item_type: 'CONFIG', failure_stage: 'config_parse', message: 'OWNED_MIGRATION_PROVIDER_SECRET_2486' }]));
      } finally { database.close(); }
      return answer({ seeded: true });
    }
    if (action === 'observations' && request.method === 'GET') {
      const mutations = entry.real ? entry.observation.methods : entry.fixture.frames.map(frame => frame.method);
      const mutationEffects = {};
      for (const method of new Set(mutations.filter(method => ['fs/writeFile', 'fs/createDirectory', 'fs/copy', 'fs/remove'].includes(method))))
        mutationEffects[method] = await nativeFilesystemMutationObserved(entry.workspace, method);
      const configurationEffects = {};
      const migrationEffects = {};
      if (entry.migration && mutations.includes('externalAgentConfig/import')) {
        migrationEffects['externalAgentConfig/import'] = (await readFile(join(entry.home, 'AGENTS.md'), 'utf8')) === 'Owned browser migration instructions.\n'
          && (await readFile(join(entry.home, 'config.toml'), 'utf8')).includes('OWNED_MIGRATION_PROVIDER_SECRET_2486');
      }
      if (entry.migration && mutations.includes('externalAgentConfig/import/recordHistory')) {
        const database = new DatabaseSync(join(entry.home, '.operations-migrations', nativeMigrationStateDatabase), { readOnly: true });
        try { migrationEffects['externalAgentConfig/import/recordHistory'] = database.prepare('SELECT count(*) AS count FROM external_agent_config_imports WHERE provider_id = ?').get('owned-browser-history').count === 1; }
        finally { database.close(); }
      }
      if (entry.directory && mutations.some(method => ['config/value/write', 'config/batchWrite', 'skills/config/write'].includes(method))) {
        const text = await readFile(join(entry.directory, 'home/config.toml'), 'utf8');
        configurationEffects['config/value/write'] = text.includes('browser-owned-config-model');
        configurationEffects['config/batchWrite'] = /model_verbosity\s*=\s*"low"/.test(text);
        configurationEffects['skills/config/write'] = text.includes('owned-configuration-skill') && /enabled\s*=\s*false/.test(text);
      }
      const marketplaceEffects = {};
      if (entry.marketplaces) {
        const config = await readFile(join(entry.home, 'config.toml'), 'utf8'), root = join(entry.home, '.tmp/marketplaces/owned-git-market');
        marketplaceEffects['marketplace/add'] = config.includes('owned-local-market') && (await readFile(join(entry.workspace, 'local-market/marker.txt'), 'utf8')).includes('initial');
        if (mutations.includes('marketplace/upgrade')) marketplaceEffects['marketplace/upgrade'] = (await readFile(join(root, 'marker.txt'), 'utf8')).includes('updated') && (await readFile(join(root, '.codex-marketplace-install.json'), 'utf8')).includes('revision');
        if (mutations.includes('marketplace/remove')) { let exists = true; try { await readFile(join(root, 'marker.txt')); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; } marketplaceEffects['marketplace/remove'] = !exists && !config.includes('[marketplaces.'); }
      }
      const pluginEffects = {};
      if (entry.pluginManagement) {
        const root = join(entry.home, 'plugins/cache/owned-market/owned-plugin'), source = await readFile(join(entry.workspace, 'owned-plugin/skills/owned-skill/SKILL.md'), 'utf8');
        const config = await readFile(join(entry.home, 'config.toml'), 'utf8');
        if (mutations.includes('plugin/install')) pluginEffects['plugin/install'] = (await readFile(join(root, '1.0.0/skills/owned-skill/SKILL.md'), 'utf8')) === source && config.includes('owned-plugin@owned-market');
        if (mutations.includes('plugin/uninstall')) {
          let exists = true; try { await readFile(join(root, '1.0.0/.codex-plugin/plugin.json')); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
          pluginEffects['plugin/uninstall'] = !exists && !config.includes('owned-plugin@owned-market') && source.includes('Owned local fixture content');
        }
        if (mutations.includes('plugin/reconcile')) pluginEffects['plugin/reconcile'] = (await readFile(join(entry.home, 'plugins/cache/openai-curated-remote/owned-remote/1.0.0/skills/owned-skill/SKILL.md'), 'utf8')).includes('Bundle version 1.0.0') && entry.provider.installation.downloads.length > 0 && entry.provider.installation.downloads.every(d => !d.authorization);
      }
      const shareEffects = {};
      if (entry.pluginSharing) {
        const state = entry.provider.sharing, source = await readFile(join(entry.workspace, 'owned-plugin/skills/owned-skill/SKILL.md'), 'utf8');
        if (mutations.includes('plugin/share/save')) shareEffects['plugin/share/save'] = state.created && state.uploads.length === 1 && !state.uploads[0].authorization && source.includes('Owned local fixture content') && JSON.parse(await readFile(join(entry.home, '.tmp/plugin-share-local-paths-v1.json'), 'utf8')).localPluginPathsByRemotePluginId[ownedSharedPluginId] === join(entry.workspace, 'owned-plugin');
        if (mutations.includes('plugin/share/updateTargets')) shareEffects['plugin/share/updateTargets'] = state.discoverability === 'UNLISTED' && state.principals.some(p => p.principal_type === 'user' && p.principal_id === 'owned-user-2' && p.role === 'editor') && state.principals.some(p => p.principal_type === 'workspace' && p.principal_id === 'owned-account' && p.role === 'reader');
        if (mutations.includes('plugin/share/checkout')) shareEffects['plugin/share/checkout'] = (await readFile(join(entry.home, 'plugins/owned-plugin/skills/owned-skill/SKILL.md'), 'utf8')).includes('Bundle version 1.0.0') && JSON.parse(await readFile(join(entry.home, '.agents/plugins/marketplace.json'), 'utf8')).plugins.some(p => p.name === 'owned-plugin') && entry.provider.installation.downloads.length === 1 && entry.provider.installation.downloads.every(d => !d.authorization);
        if (mutations.includes('plugin/share/delete')) {
          let exists = true; try { await readFile(join(entry.home, '.tmp/plugin-share-local-paths-v1.json')); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
          shareEffects['plugin/share/delete'] = !state.created && !exists && source.includes('Owned local fixture content');
        }
      }
      return answer({ shareEffects, pluginEffects, marketplaceEffects, migrationEffects, requests: entry.fixture.requests, sockets: entry.fixture.sockets,
      starts: entry.real ? entry.observation.starts : entry.fixture.starts, stops: entry.real ? entry.observation.stops : entry.fixture.stops,
      methods: entry.real ? entry.observation.methods : entry.fixture.frames.map(frame => frame.method), real: entry.real,
      mutationEffects, configurationEffects, ...(entry.oauth ? { oauth: { stored: await entry.oauth.stored(), pkceVerified: entry.oauth.pkceVerified } } : {}), ...(entry.provider ? { providerRequests: entry.provider.requests, providerHeld: entry.provider.pending?.filter(value => !value.closed).length ?? 0, providerResponseCount: entry.provider.pending?.length ?? 0 } : {}), ...(entry.real ? { responseShapes: entry.observation.responseShapes, notifications: entry.observation.notifications, authorityChanges: entry.observation.authorityChanges } : {}) });
    }
    if (action === 'authorize-mcp' && request.method === 'POST' && entry.oauth) {
      const parts = []; let bytes = 0; for await (const part of request) { bytes += part.length; if (bytes > 10000) throw new Error(); parts.push(part); }
      const { authorizationUrl } = JSON.parse(Buffer.concat(parts).toString('utf8'));
      return answer({ status: await entry.oauth.authorize(authorizationUrl) });
    }
    if (action === 'finish-mcp' && request.method === 'POST' && !entry.real && entry.fixture.finishMcp) { entry.fixture.finishMcp(); return answer({ completed: true }); }
    if (action === 'finish-gateway' && request.method === 'POST' && !entry.real && entry.fixture.finishGateway) { entry.fixture.finishGateway(); return answer({ completed: true }); }
    if (action === 'finish-login' && request.method === 'POST' && !entry.real && entry.fixture.finishLogin) { entry.fixture.finishLogin(); return answer({ completed: true }); }
    if (['guardian-tool', 'guardian-deny'].includes(action) && request.method === 'POST') {
      if (entry.real) {
        const pending = entry.provider?.pending.find(value => !value.closed); if (!pending) throw new Error('No owned Guardian response pending.');
        if (action === 'guardian-tool') pending.finishTool('exec_command', { cmd: 'printf OWNED_GUARDIAN_DENIAL', sandbox_permissions: 'require_escalated', justification: 'Owned browser approval fixture.' });
        else pending.finish('{"outcome":"deny","risk_level":"high","user_authorization":"low","rationale":"Owned browser Guardian denial."}');
      }
      return answer({ completed: true });
    }
    if (action === 'finish-response' && request.method === 'POST' && !entry.real && entry.fixture.completeTurn) { entry.fixture.completeTurn(); return answer({ completed: true }); }
    if (action === 'finish-response' && request.method === 'POST' && entry.real && entry.provider?.pending) {
      const pending = entry.provider.pending.find(value => !value.closed);
      if (!pending) throw new Error('No owned provider response is pending.');
      pending.finish(JSON.stringify({ findings: [], overall_correctness: 'patch is correct', overall_explanation: 'Owned browser review.', overall_confidence_score: 1 }));
      return answer({ completed: true });
    }
    if ((action === 'touch-watch' || action === 'remove-watch') && request.method === 'POST') {
      const path = join(entry.workspace, 'watched.txt');
      if (action === 'remove-watch') await rm(path); else await writeFile(path, 'Owned browser change ' + randomUUID());
      if (!entry.real) for (const watchId of entry.fixture.sdkWatches.keys()) entry.fixture.emitWatch(watchId, [path]);
      return answer({ changed: true });
    }
    if (action === 'cut' && request.method === 'POST' && !entry.real) { entry.fixture.exit(); return answer({ closed: true }); }
    if (action === 'change-account' && request.method === 'POST' && !entry.real) { entry.fixture.identity.accountEpoch = randomUUID(); return answer({ changed: true }); }
    if (action === 'close' && request.method === 'DELETE') { await remove(entry); entries.delete(id); return answer({ closed: true }); }
    throw new Error();
  }
  return { handle(request, response) {
    const match = /^\/native-companion-fixture\/([a-f0-9-]{36})\/(create|observations|seed-migration-history|change-account|authorize-mcp|finish-mcp|finish-login|finish-gateway|finish-response|guardian-tool|guardian-deny|touch-watch|remove-watch|cut|close)$/.exec(new URL(request.url, 'http://localhost').pathname);
    if (!match) return false;
    void handle(request, response, match).catch(cause => {
      const diagnostic = cause instanceof MissingNativeQualificationPin ? { message: cause.message, missing: cause.missing } : {};
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'native_fixture_unavailable', ...diagnostic }));
    });
    return true;
  }, async close() { for (const entry of entries.values()) await remove(entry); entries.clear(); } };
}
