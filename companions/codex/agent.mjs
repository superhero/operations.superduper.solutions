// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeAccountReadMethod, nativeAccountReadParams, nativeAccountReadWireParams } from '../../src/lib/native-account-read.ts';
import { isNativeAccountActionMethod } from '../../src/lib/native-account-actions.ts';
import { isNativeGatewayOAuthMethod } from '../../src/lib/native-gateway-oauth.ts';
import { isNativeTurnControlMethod, nativeTurnControlParams, nativeTurnControlResult } from '../../src/lib/native-turn-control.ts';
import { isNativeTurnWorkMethod, nativeTurnWorkParams, nativeTurnWorkAcknowledgement } from '../../src/lib/native-turn-work.ts';
import { nativeGuardianMethod, nativeGuardianApprovalMethod, nativeGuardianParams, nativeGuardianStarted, nativeGuardianCompleted, NativeGuardianReviews } from '../../src/lib/native-guardian.ts';
import { NativeMcpOAuthCorrelation, nativeMcpOAuthMethod, nativeMcpOAuthNotification, nativeMcpOAuthParams } from '../../src/lib/native-mcp-oauth.ts';
import { nativeMcpToolMethod, nativeMcpToolParams } from '../../src/lib/native-mcp-tool.ts';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { isNativeWorkflowMethod, nativeLoginParams, nativeWorkflowParams, nativeOwnedId, nativeRpcId } from '../../src/lib/native-agent-contract.ts';
import { randomUUID } from 'node:crypto';
import { nativeThreadShellMethod, nativeThreadShellApprovalMethod, nativeThreadShellParams, nativeThreadShellItem } from '../../src/lib/native-thread-shell.ts';
import { nativeWindowsSandboxReadinessMethod } from '../../src/lib/native-windows-sandbox.ts';
import { isNativePluginShareMethod, nativePluginShareParams } from '../../src/lib/native-plugin-share.ts';
import { isNativePluginInstallMethod, nativePluginInstallParams } from '../../src/lib/native-plugin-install.ts';
import { isNativeMarketplaceMethod, nativeMarketplaceParams } from '../../src/lib/native-marketplace.ts';
import { isNativePluginReadMethod, nativePluginReadParams } from '../../src/lib/native-plugin-read.ts';
import { isNativeConfigurationReadMethod, nativeConfigurationReadParams } from '../../src/lib/native-configuration-read.ts';
import { isNativeConfigurationControlMethod, nativeConfigurationControlParams } from '../../src/lib/native-configuration-control.ts';
import { isNativeConfigurationWriteMethod, nativeConfigurationWriteParams, nativeConfigurationTransition, nativeConfigurationWriteHash } from '../../src/lib/native-configuration-write.ts';
import { isNativeMigrationMethod, nativeMigrationParams, nativeMigrationTransition, NativeMigrationCorrelation,
  nativeMigrationProgress, nativeMigrationCompleted } from '../../src/lib/native-migration.ts';
import { isNativeStoredThreadReadMethod, nativeStoredThreadReadParams } from '../../src/lib/native-stored-thread.ts';
import { isNativeThreadLifecycleMethod, nativeThreadLifecycleParams } from '../../src/lib/native-thread-lifecycle.ts';
import { isNativeThreadContentMethod, isNativeThreadAttachmentMutation, nativeThreadContentParams } from '../../src/lib/native-thread-content.ts';

/** A single paired owner's login/turn lifecycle, with no generic RPC proxy. */
export function createCodexAgentSession({ identity, authority, accountUpdateIsUnchanged, send, write, threads, allowAgent = true, allowAccountAuth = false, allowMcpTools = false, allowMcpOAuth = false, allowThreadShell = false,
  allowGuardian = false, prepareGuardianDenial,
  allowAccountRead = false, prepareAccountRead, reviewAccountRead, reviewAccountMetadata,
  allowThreadsRead = false, prepareStoredThreadRead, reviewStoredThreadRead,
  allowThreadsWrite = false, prepareThreadLifecycle, reviewThreadLifecycle,
  prepareThreadContent, reviewThreadContent, inspectThreadGoal,
  allowMarketplaces = false, prepareMarketplace, reviewMarketplace,
  allowPluginManagement = false, preparePluginInstall, reviewPluginInstall,
  allowPluginSharing = false, preparePluginShare, reviewPluginShare,
  allowWindowsSandboxReadiness = false, prepareWindowsReadiness, reviewWindowsReadiness,
  allowPluginsRead = false, preparePluginRead, reviewPluginRead,
  allowConfigurationRead = false, prepareConfigurationRead, reviewConfigurationRead,
  allowConfigurationControl = false, prepareConfigurationControl, reviewConfigurationControl,
  allowConfigurationWrite = false, prepareConfigurationWrite, reviewConfigurationWrite, configurationWriteAuthority,
  allowMigration = false, prepareMigration, dispatchMigration, reviewMigration, migrationAuthority, finishMigration, abortMigration }) {
  const requests = new Map(), approvals = new Map(), loadedThreads = new Set();
  const goalAuthorities = new Set(), goalTurns = new Map(), loginIds = new Set(), cancelledLogins = new Set();
  const guardianReviews = new NativeGuardianReviews(), guardianThreads = new Set();
  let login, turn, tool, mcpLogin, shell, configuration, guardianApproval, accountChanged = false;
  const bound = value => typeof value === 'string' && value.length <= 8192 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const sameBase = value => sameNativeIdentity(identity, { ...value, accountEpoch: identity.accountEpoch });
  async function check() {
    if (configuration?.context) {
      const current = await (configuration.migration ? migrationAuthority : configurationWriteAuthority)(configuration.context);
      if (!sameNativeIdentity(identity, { ...current, configuration: identity.configuration })) throw new Error('Native write authority changed.');
      return current;
    }
    const current = await authority();
    if (!sameBase(current) || current.accountEpoch !== identity.accountEpoch && !login) throw new Error('Native authority changed.');
    return current;
  }
  async function finishMigrationRequest(owned, result, completion) {
    await check();
    const verified = await reviewMigration(owned.context, result, completion), current = await migrationAuthority(owned.context);
    if (configuration !== owned || !sameNativeIdentity(verified.identity, current)) throw new Error('Migration changed after verification.');
    if (owned.method === 'externalAgentConfig/import') {
      const before = { ...identity }, resultHash = await nativeConfigurationWriteHash(verified.result);
      const receipt = nativeMigrationTransition({ type: 'authority', reason: 'migration', requestId: owned.id, method: owned.method,
        paramsHash: owned.paramsHash, resultHash, effectHash: verified.effectHash, beforeConfiguration: before.configuration,
        identity: verified.identity, privateValues: verified.privateValues }, before, owned.id, owned.paramsHash, resultHash);
      Object.assign(identity, receipt.identity);
      for (const [id, bound] of threads) if (sameNativeIdentity(bound, before)) threads.set(id, { ...identity });
      send(receipt);
    } else if (!sameNativeIdentity(identity, verified.identity)) throw new Error('A metadata request changed migration authority.');
    requests.delete(owned.id); finishMigration(owned.context); configuration = undefined;
    send({ id: owned.id, result: verified.result }); return true;
  }
  const ownedThread = id => nativeOwnedId(id) && threads.has(id) && sameNativeIdentity(threads.get(id), identity);
  async function request(frame) {
    if (Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error')) {
      const reply = nativeObject(frame, ['id', 'result']), prompt = approvals.get(reply.id);
      if (!prompt) throw new Error('Unknown native approval.');
      const result = nativeObject(reply.result, ['decision']);
      if (!['accept', 'decline', 'cancel'].includes(result.decision)) throw new Error('Unsupported approval decision.');
      approvals.delete(reply.id);
      if (prompt.guardian) {
        const owned = guardianApproval;
        if (!owned || owned.approvalId !== reply.id || result.decision !== 'accept') throw new Error('Guardian denial was not approved.');
        await check();
        const denial = guardianReviews.get(owned.params), event = await prepareGuardianDenial(denial); await check();
        if (guardianApproval !== owned || JSON.stringify(denial) !== JSON.stringify(owned.denial)) throw new Error('Guardian denial changed before approval.');
        guardianReviews.consume(owned.params); guardianApproval = undefined;
        write({ id: owned.id, method: nativeGuardianMethod, params: { threadId: owned.params.threadId, event } }); return false;
      }
      if (prompt.shell) {
        if (!shell || shell.approvalId !== reply.id || result.decision !== 'accept') throw new Error('Shell command was not authorized.');
        await check();
        if (login || turn || tool || mcpLogin || !ownedThread(shell.frame.params.threadId) || !loadedThreads.has(shell.frame.params.threadId)) throw new Error('Shell authority changed.');
        turn = { requestId: shell.frame.id, threadId: shell.frame.params.threadId, shell: true };
        const selected = shell.frame; shell = undefined; write(selected); return false;
      }
      write(frame); return false;
    }
    const { id, method, params } = frame;
    if (isNativeAccountActionMethod(method) || isNativeGatewayOAuthMethod(method)) throw new Error('This account operation requires its dedicated scope.');
    if (configuration) throw new Error('A configuration request is already pending.');
    if (guardianApproval) throw new Error('A Guardian confirmation is already pending.');
    if (['thread/rollback', 'thread/revert', 'thread/archive', 'thread/unload', 'thread/delete', 'thread/resume'].includes(method) && typeof params?.threadId === 'string') guardianReviews.forgetThread(params.threadId);
    if (method === 'account/read') {
      nativeObject(params, ['refreshToken']); if (params.refreshToken !== false) throw new Error();
      if (login) {
        if (!login.completed || login.cancelled) throw new Error('Account confirmation is not ready.');
        login.confirmationAuthority = await check();
      }
    } else if (method === 'account/login/start') {
      if ((!allowAgent && !allowAccountAuth) || login || turn || goalTurns.size || tool || mcpLogin || shell) throw new Error('The native runtime is busy or account sign-in is not granted.');
      const input = nativeLoginParams(params); login = { id, type: input.type, completed: false };
    } else if (method === 'account/login/cancel') {
      nativeObject(params, ['loginId']);
      if ((!allowAgent && !allowAccountAuth) || !loginIds.has(params.loginId) || login && params.loginId !== login.loginId) throw new Error('Unknown owned sign-in.');
      cancelledLogins.add(params.loginId); if (login) login.cancelled = true;
    } else if (method === 'account/logout') {
      nativeObject(params, []);
      if (!allowAccountAuth || login || turn || goalTurns.size || tool || mcpLogin || shell || requests.size) throw new Error('Account sign-out authority is unavailable or busy.');
      login = { id, type: 'logout', completed: false };
    } else if (method === nativeMcpOAuthMethod) {
      nativeMcpOAuthParams(params);
      if (!allowMcpOAuth || login || turn || tool || mcpLogin || shell || params.threadId != null && (!allowAgent || !ownedThread(params.threadId) || !loadedThreads.has(params.threadId))) throw new Error('MCP login authority is unavailable or busy.');
      mcpLogin = { id, correlation: new NativeMcpOAuthCorrelation(params) };
    } else if (method === nativeMcpToolMethod) {
      nativeMcpToolParams(params);
      if (!allowAgent || !allowMcpTools || login || turn || goalTurns.size || tool || mcpLogin || shell || !ownedThread(params.threadId) || !loadedThreads.has(params.threadId)) throw new Error('MCP tool authority is unavailable or busy.');
      tool = { id, threadId: params.threadId };
    } else if (method === nativeThreadShellMethod) {
      if (!allowAgent || !allowThreadShell || login || turn || goalTurns.size || tool || mcpLogin || shell || !ownedThread(params.threadId) || !loadedThreads.has(params.threadId)) throw new Error('Thread shell authority is unavailable or busy.');
      const prepared = nativeThreadShellParams(params), approvalId = randomUUID();
      shell = { frame: { id, method, params: prepared }, approvalId }; requests.set(id, { method, params: prepared });
      approvals.set(approvalId, { shell: true });
      send({ id: approvalId, method: nativeThreadShellApprovalMethod, params: { requestId: id, params: prepared, unsandboxed: true } }); return false;
    } else if (isNativeThreadContentMethod(method)) {
      if (!allowThreadsWrite || typeof prepareThreadContent !== 'function' || typeof reviewThreadContent !== 'function'
        || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Thread content authority is unavailable or busy.');
      const input = nativeThreadContentParams(method, params);
      if (!isNativeThreadAttachmentMutation(method) && method !== 'thread/goal/clear'
        && (!allowAgent || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId))) throw new Error('History and goal updates require an owned loaded agent thread.');
      const owned = { id, method, content: true }; configuration = owned;
      try {
        const plan = await prepareThreadContent(method, input); await check();
        if (configuration !== owned || plan.method !== method || plan.input.threadId !== input.threadId) throw new Error('Thread content preparation lost its owner.');
        owned.plan = plan;
        if (method === 'thread/revert') loadedThreads.delete(input.threadId);
        requests.set(id, { method, params: input }); return { id, method, params: plan.params };
      } catch (error) { if (configuration === owned) configuration = undefined; throw error; }
    } else if (isNativeThreadLifecycleMethod(method)) {
      if (!allowThreadsWrite || typeof prepareThreadLifecycle !== 'function' || typeof reviewThreadLifecycle !== 'function'
        || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Thread lifecycle authority is unavailable or busy.');
      const input = nativeThreadLifecycleParams(method, params);
      if (method === 'thread/fork' && (!allowAgent || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId) || threads.size >= 64))
        throw new Error('Fork requires an owned loaded agent thread.');
      const owned = { id, method, lifecycle: true }; configuration = owned;
      try {
        const plan = await prepareThreadLifecycle(method, input); await check();
        if (configuration !== owned || plan.method !== method || plan.input.threadId !== input.threadId) throw new Error('Thread lifecycle preparation lost its owner.');
        owned.plan = plan;
        if (['thread/archive', 'thread/delete', 'thread/unsubscribe'].includes(method)) for (const threadId of plan.ids) loadedThreads.delete(threadId);
        requests.set(id, { method, params: input }); return { id, method, params: plan.params };
      } catch (error) { if (configuration === owned) configuration = undefined; throw error; }
    } else if (isNativeStoredThreadReadMethod(method)) {
      if (!allowThreadsRead || typeof prepareStoredThreadRead !== 'function' || typeof reviewStoredThreadRead !== 'function'
        || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Stored-thread read authority is unavailable or busy.');
      const input = nativeStoredThreadReadParams(method, params), prepared = await prepareStoredThreadRead(method, input); await check();
      configuration = { id, method }; requests.set(id, { method, params: prepared });
      return { id, method, params: prepared };
    } else if (isNativeAccountReadMethod(method)) {
      if (!allowAccountRead || typeof prepareAccountRead !== 'function' || typeof reviewAccountRead !== 'function'
        || login || turn || goalTurns.size || tool || mcpLogin || shell || requests.size) throw new Error('Account read authority is unavailable or busy.');
      const owned = { id, method }; configuration = owned;
      try {
        const plan = await prepareAccountRead(method, nativeAccountReadParams(method, params)); await check();
        if (configuration !== owned) throw new Error('Account read lost its owner.');
        owned.plan = plan; requests.set(id, { method, params: plan.params });
        return { id, method, params: nativeAccountReadWireParams(method, plan.params) };
      } catch (error) { if (configuration === owned) configuration = undefined; throw error; }
    } else if (method === nativeWindowsSandboxReadinessMethod) {
      if (!allowWindowsSandboxReadiness || typeof prepareWindowsReadiness !== 'function' || typeof reviewWindowsReadiness !== 'function'
        || login || turn || tool || mcpLogin || shell || configuration || requests.size) throw new Error('Windows readiness authority is unavailable or busy.');
      const plan = await prepareWindowsReadiness(params); await check();
      requests.set(id, { method, plan }); return { id, method, params: null };
    } else if (isNativePluginReadMethod(method)) {
      if (!allowPluginsRead || typeof preparePluginRead !== 'function' || typeof reviewPluginRead !== 'function'
        || login || turn || goalTurns.size || tool || mcpLogin || shell || requests.size) throw new Error('Plugin read authority is unavailable or busy.');
      const owned = { id, method, plugin: true }; configuration = owned;
      try {
        const plan = await preparePluginRead(method, nativePluginReadParams(method, params)); await check();
        if (configuration !== owned || plan.method !== method) throw new Error('Plugin read lost its owner.');
        owned.plan = plan; requests.set(id, { method, params: plan.params });
        return { id, method, params: plan.params };
      } catch (error) { if (configuration === owned) configuration = undefined; throw error; }
    } else if (isNativeConfigurationReadMethod(method)) {
      if (!allowConfigurationRead || typeof prepareConfigurationRead !== 'function' || typeof reviewConfigurationRead !== 'function'
        || login || turn || tool || mcpLogin || shell) throw new Error('Configuration read authority is unavailable or busy.');
      const input = nativeConfigurationReadParams(method, params);
      if (input.threadId != null && (!allowAgent || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId))) throw new Error('Configuration read thread is not owned and loaded.');
      const prepared = await prepareConfigurationRead(method, input); await check();
      configuration = { id, method };
      requests.set(id, { method, params: prepared });
      return { id, method, params: method === 'configRequirements/read' ? null : prepared };
    } else if (isNativeConfigurationControlMethod(method)) {
      if (!allowConfigurationControl || typeof prepareConfigurationControl !== 'function' || typeof reviewConfigurationControl !== 'function'
        || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Configuration control authority is unavailable or busy.');
      const input = nativeConfigurationControlParams(method, params), prepared = await prepareConfigurationControl(method, input); await check();
      configuration = { id, method }; requests.set(id, { method, params: prepared });
      return { id, method, params: method === 'config/mcpServer/reload' ? null : prepared };
    } else if (isNativeConfigurationWriteMethod(method) || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method)) {
      const marketplace = isNativeMarketplaceMethod(method), plugins = isNativePluginInstallMethod(method), sharing = isNativePluginShareMethod(method), prepare = sharing ? preparePluginShare : plugins ? preparePluginInstall : marketplace ? prepareMarketplace : prepareConfigurationWrite, review = sharing ? reviewPluginShare : plugins ? reviewPluginInstall : marketplace ? reviewMarketplace : reviewConfigurationWrite;
      if (!(sharing ? allowPluginSharing : plugins ? allowPluginManagement : marketplace ? allowMarketplaces : allowConfigurationWrite) || typeof prepare !== 'function' || typeof review !== 'function'
        || typeof configurationWriteAuthority !== 'function' || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Configuration write authority is unavailable or busy.');
      const input = sharing ? nativePluginShareParams(method, params) : plugins ? nativePluginInstallParams(method, params) : marketplace ? nativeMarketplaceParams(method, params) : nativeConfigurationWriteParams(method, params), selected = { id, method };
      configuration = selected;
      try {
        const context = await prepare(method, input), paramsHash = await nativeConfigurationWriteHash(input);
        await check();
        if (configuration !== selected || !sameNativeIdentity(context.before.identity, identity)) throw new Error('Configuration write preparation lost its owner.');
        Object.assign(selected, { context, paramsHash }); requests.set(id, { method, params: input });
        return { id, method, params: context.params };
      } catch (error) { if (configuration === selected) configuration = undefined; throw error; }
    } else if (isNativeMigrationMethod(method)) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Migration requires an owned bounded request ID.');
      if (!allowMigration || [prepareMigration, dispatchMigration, reviewMigration, migrationAuthority, finishMigration, abortMigration].some(value => typeof value !== 'function')
        || login || turn || tool || mcpLogin || shell || requests.size) throw new Error('Migration authority is unavailable or busy.');
      const input = nativeMigrationParams(method, params), owned = { id, method, migration: true }; configuration = owned;
      try {
        owned.context = await prepareMigration(method, input); owned.paramsHash = await nativeConfigurationWriteHash(input);
        if (method === 'externalAgentConfig/import') owned.correlation = new NativeMigrationCorrelation(owned.context.params);
        await check();
        if (configuration !== owned || !sameNativeIdentity(owned.context.before.identity, identity)) throw new Error('Migration preparation lost its owner.');
        const prepared = await dispatchMigration(owned.context);
        if (configuration !== owned) throw new Error('Migration dispatch lost its owner.');
        requests.set(id, { method, params: input }); return { id, method, params: prepared };
      } catch (error) { if (owned.context) abortMigration(owned.context); if (configuration === owned) configuration = undefined; throw error; }
    } else if (isNativeTurnControlMethod(method)) {
      const input = nativeTurnControlParams(method, params);
      if (!allowAgent || !turn || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId) || input.threadId !== turn.threadId
        || method === 'turn/steer' && (turn.shell || turn.work || input.expectedTurnId !== turn.id)
        || method === 'turn/interrupt' && input.turnId !== '' && input.turnId !== (turn.reviewDelegateId ?? turn.id)) throw new Error('Unknown owned active turn.');
      frame = { ...frame, params: input }; requests.set(id, { method, params: input }); return frame;
    } else if (method === nativeGuardianMethod) {
      const input = nativeGuardianParams(params);
      if (!allowAgent || !allowGuardian || typeof prepareGuardianDenial !== 'function' || login || turn || goalTurns.size || tool || mcpLogin || shell || requests.size
        || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId) || !guardianThreads.has(input.threadId)) throw new Error('Guardian denial approval requires its granted idle owned thread.');
      const denial = guardianReviews.get(input); await prepareGuardianDenial(denial); await check();
      const approvalId = randomUUID(); guardianApproval = { id, params: input, denial, approvalId };
      requests.set(id, { method, params: input }); approvals.set(approvalId, { guardian: true });
      send({ id: approvalId, method: nativeGuardianApprovalMethod, params: { requestId: id, denial } }); return false;
    } else if (isNativeTurnWorkMethod(method)) {
      const input = nativeTurnWorkParams(method, params);
      if (!allowAgent || login || turn || goalTurns.size || tool || mcpLogin || shell || requests.size || !ownedThread(input.threadId) || !loadedThreads.has(input.threadId))
        throw new Error('Review and compaction require an idle owned loaded thread.');
      turn = { requestId: id, threadId: input.threadId, work: method };
      requests.set(id, { method, params: input }); return { id, method, params: input };
    } else if (isNativeWorkflowMethod(method)) {
      nativeWorkflowParams(method, params);
      if (!allowAgent || login || turn || goalTurns.size || tool || mcpLogin || shell || !ownedThread(params.threadId) && method !== 'thread/start') throw new Error('The native thread is not owned or is busy.');
      if (method === 'turn/start' && !loadedThreads.has(params.threadId)) throw new Error('The native thread must be resumed before execution.');
      if (method === 'turn/start') turn = { requestId: id, threadId: params.threadId };
      // The default stays human review. Explicit AI review also needs the
      // companion owner's independent grant; permission profiles stay fixed.
      if (method !== 'turn/start') {
        if (params.approvalsReviewer === 'auto_review' && !allowGuardian) throw new Error('Guardian review is not granted.');
        frame = { ...frame, params: { ...params, approvalPolicy: 'on-request', approvalsReviewer: params.approvalsReviewer ?? 'user' } };
      }
    } else throw new Error('Unsupported native method.');
    requests.set(id, { method, params }); return method === "account/logout" ? { ...frame, params: null } : frame;
  }
  async function receive(frame) {
    if ((shell || turn?.shell || turn?.work) && (Object.hasOwn(frame, 'method')
      ? ['turn/started', 'turn/completed', 'item/started', 'item/completed'].includes(frame.method)
      : requests.get(frame.id)?.method === nativeThreadShellMethod || isNativeTurnWorkMethod(requests.get(frame.id)?.method))) await check();
    if (Object.hasOwn(frame, 'method')) {
      const p = frame.params;
      if (frame.method === nativeGuardianStarted || frame.method === nativeGuardianCompleted) {
        if (!allowGuardian || Object.hasOwn(frame, 'id') || !p || !ownedThread(p.threadId) || !guardianThreads.has(p.threadId)) throw new Error('Unowned Guardian review event.');
        // Autonomous goals retain their existing noninteractive event boundary.
        if ((!turn || turn.threadId !== p.threadId) && goalTurns.get(p.threadId) === p.turnId) return true;
        if (!turn?.id || turn.shell || turn.work || p.threadId !== turn.threadId || p.turnId !== turn.id) throw new Error('Guardian event has no owned foreground turn.');
        await check();
        if (frame.method === nativeGuardianStarted) guardianReviews.started(p, turn.threadId, turn.id);
        else {
          const denial = guardianReviews.completed(p, turn.threadId, turn.id);
          if (denial) { await prepareGuardianDenial(denial); await check(); }
        }
        send(frame); return true;
      }
      if (p && (goalAuthorities.has(p.threadId) || goalTurns.has(p.threadId))
        && (!turn || turn.threadId !== p.threadId) && ['turn/started', 'turn/completed'].includes(frame.method)) {
        await check();
        if (!nativeOwnedId(p.turn?.id)) throw new Error('Invalid autonomous goal turn.');
        const current = goalTurns.get(p.threadId);
        if (frame.method === 'turn/started') {
          if (Object.hasOwn(frame, 'id') || current || !goalAuthorities.has(p.threadId) || !ownedThread(p.threadId)) throw new Error('Unowned autonomous goal turn.');
          goalTurns.set(p.threadId, p.turn.id);
        } else {
          if (Object.hasOwn(frame, 'id') || current !== p.turn.id || !['completed', 'interrupted', 'failed'].includes(p.turn.status)) throw new Error('Unowned autonomous goal completion.');
          goalTurns.delete(p.threadId);
        }
        // Goal mutation returns its native acknowledgement. Background turn
        // content remains private; it is available through scoped history reads.
        return true;
      }
      if (Object.hasOwn(frame, 'id') && p && goalTurns.get(p.threadId) === p.turnId) {
        await check();
        if (!nativeRpcId(frame.id)) throw new Error('Invalid autonomous goal interaction.');
        write({ id: frame.id, error: { code: -32601, message: 'Background goal interactions require an interactive workflow.' } }); return true;
      }
      if (frame.method === nativeMigrationProgress || frame.method === nativeMigrationCompleted) {
        const owned = configuration;
        if (!owned?.migration || !owned.correlation || Object.hasOwn(frame, 'id')) throw new Error('Unowned migration event.');
        const completed = owned.correlation.notification(frame.method, p);
        if (completed) return finishMigrationRequest(owned, owned.ack, completed);
        return true;
      }
      if (frame.method === nativeMcpOAuthNotification) {
        if (!mcpLogin || Object.hasOwn(frame, 'id')) throw new Error('Unowned MCP completion.');
        await check(); const completed = mcpLogin.correlation.complete(p);
        if (completed) { mcpLogin = undefined; send({ method: nativeMcpOAuthNotification, params: completed }); } return true;
      }
      if (Object.hasOwn(frame, 'id')) {
        if (shell || turn?.shell) throw new Error('Thread shell does not grant agent interactions.');
        if (tool || mcpLogin) {
          if (!nativeRpcId(frame.id)) throw new Error('Invalid MCP interaction ID.');
          write({ id: frame.id, error: { code: -32601, message: 'MCP interactions are not authorized by the tool call.' } }); return true;
        }
        if (!nativeRpcId(frame.id) || approvals.size >= 8 || approvals.has(frame.id) || !turn?.id || !p
          || p.threadId !== turn.threadId || p.turnId !== turn.id || !nativeOwnedId(p.itemId)) throw new Error('Unowned native interaction.');
        if (frame.method !== 'item/commandExecution/requestApproval'
          || p.grantRoot != null || p.networkApprovalContext != null || p.proposedNetworkPolicyAmendments != null
          || p.proposedExecpolicyAmendment != null || p.environmentId != null || p.kind != null && p.kind !== 'command') {
          write({ id: frame.id, error: { code: -32601, message: 'This interaction is not supported by Operations.' } });
          throw new Error('Unsupported native interaction.');
        }
        if (frame.method === 'item/commandExecution/requestApproval' && (!bound(p.command) || !p.command.trim())
          || [p.reason, p.cwd].some(value => value != null && !bound(value))) throw new Error('Invalid native interaction.');
        approvals.set(frame.id, { threadId: turn.threadId, turnId: turn.id }); send(frame); return true;
      }
      if (frame.method === 'account/updated') {
        if (!login && await accountUpdateIsUnchanged?.(identity)) { await check(); return true; }
        if (!login || login.cancelled) throw new Error('Account authority changed.');
        accountChanged = true; return true;
      }
      if (frame.method === 'account/login/completed') {
        if (p?.success === false && cancelledLogins.has(p.loginId)) return true;
        if (login?.type === 'apiKey') {
          if (!p || p.loginId != null || typeof p.success !== 'boolean' || login.completed) throw new Error('Invalid API-key completion.');
          if (!login.ack) { if (login.early) throw new Error('Duplicate API-key completion.'); login.early = frame; return true; }
          login.completed = p.success; send(frame); return true;
        }
        if (!login || login.type === 'apiKey' || !p || typeof p.success !== 'boolean' || !nativeOwnedId(p.loginId)) throw new Error('Unowned login completion.');
        if (login.loginId && login.loginId !== p.loginId || login.early) throw new Error('Unowned login completion.');
        if (!login.loginId) { login.early = frame; return true; }
        login.completed = p.success; send(frame); return true;
      }
      if (frame.method === 'turn/started' || frame.method === 'turn/completed') {
        // Inline review forwards its delegate's TurnStarted under the owned
        // parent thread, but its acknowledgement and terminal use the parent
        // operation ID. Retain the parent result owner and the delegate's
        // observed ID separately: native interruption targets the delegate.
        if (frame.method === 'turn/started' && turn?.work === 'review/start') {
          if (!p || p.threadId !== turn.threadId || !nativeOwnedId(p.turn?.id)) throw new Error('Unowned review start.');
          if (!turn.ack) { if (turn.reviewEarlyStart) throw new Error('Duplicate review start.'); turn.reviewEarlyStart = frame; return true; }
          if (p.turn.id !== turn.id) { if (turn.reviewDelegateId) throw new Error('Duplicate review delegate start.'); turn.reviewDelegateId = p.turn.id; send(frame); return true; }
        }
        if (!turn || !p || p.threadId !== turn.threadId || !nativeOwnedId(p.turn?.id)
          || turn.id && turn.id !== p.turn.id) throw new Error('Unowned turn event.');
        turn.id = p.turn.id;
        if (turn.shell && frame.method === 'turn/started') { if (turn.started) throw new Error('Duplicate shell turn start.'); turn.started = true; }
        if (frame.method === 'turn/completed') {
          if (!['completed', 'interrupted', 'failed'].includes(p.turn.status) || !Array.isArray(p.turn.items)) throw new Error('Invalid terminal turn.');
          if (turn.shell && (!turn.started || p.turn.status === 'completed' && !turn.item)) throw new Error('Shell command has no owned terminal item.');
          if (!turn.ack) { if (turn.terminal) throw new Error(); turn.terminal = frame; return true; }
          approvals.clear(); turn = undefined;
        }
        send(frame); return true;
      }
      if (turn?.shell && (frame.method === 'item/started' || frame.method === 'item/completed')) {
        if (!turn.started || !turn.id) throw new Error('Shell item preceded its turn.');
        const started = frame.method === 'item/started';
        if (started && turn.itemId || !started && (!turn.itemId || turn.item)) throw new Error('Duplicate or reordered shell item.');
        const item = nativeThreadShellItem(frame, turn.threadId, turn.id, started ? 'started' : 'completed', turn.itemId);
        if (started) turn.itemId = item.params.item.id; else turn.item = item;
        send(item); return true;
      }
      // Streaming/log/account data are not an unbounded channel to the page.
      return true;
    }
    const selected = requests.get(frame.id); if (!selected) return false;
    if (isNativeTurnControlMethod(selected.method)) {
      await check(); requests.delete(frame.id);
      if (Object.hasOwn(frame, 'error')) send({ id: frame.id, error: { code: -32000, message: 'Native turn control did not complete.' } });
      else send({ id: frame.id, result: nativeTurnControlResult(selected.method, frame.result, selected.params) });
      return true;
    }
    if (selected.method === nativeGuardianMethod) {
      await check(); requests.delete(frame.id);
      if (Object.hasOwn(frame, 'error')) send({ id: frame.id, error: { code: -32000, message: 'Native Guardian denial approval did not complete.' } });
      else { nativeObject(frame.result, []); send({ id: frame.id, result: {} }); }
      return true;
    }
    if (isNativeMigrationMethod(selected.method)) {
      const owned = configuration;
      if (!owned?.migration || owned.id !== frame.id || !owned.context) throw new Error('Unowned migration acknowledgement.');
      if (Object.hasOwn(frame, 'error')) {
        abortMigration(owned.context); requests.delete(frame.id); configuration = undefined;
        send({ id: frame.id, error: { code: -32603, message: 'Native migration failed.' } }); return true;
      }
      if (owned.correlation) {
        if (owned.ack) throw new Error('Duplicate migration acknowledgement.');
        owned.ack = frame.result;
        const completed = owned.correlation.acknowledge(frame.result);
        if (!completed) return true;
        return finishMigrationRequest(owned, frame.result, completed);
      }
      return finishMigrationRequest(owned, frame.result);
    }
    requests.delete(frame.id);
    if (isNativeConfigurationWriteMethod(selected.method) || isNativeMarketplaceMethod(selected.method) || isNativePluginInstallMethod(selected.method) || isNativePluginShareMethod(selected.method)) {
      const owned = configuration;
      if (owned?.id !== frame.id || !owned.context) throw new Error('Unowned configuration write response.');
      await check();
      if (Object.hasOwn(frame, 'error')) {
        configuration = undefined; await check();
        send({ id: frame.id, error: { code: -32603, message: 'Native configuration write failed.' } }); return true;
      }
      const verified = await (isNativePluginShareMethod(selected.method) ? reviewPluginShare : isNativePluginInstallMethod(selected.method) ? reviewPluginInstall : isNativeMarketplaceMethod(selected.method) ? reviewMarketplace : reviewConfigurationWrite)(owned.context, frame.result), resultHash = await nativeConfigurationWriteHash(verified.result);
      const current = await configurationWriteAuthority(owned.context);
      if (configuration !== owned || !sameNativeIdentity(verified.identity, current)) throw new Error('Configuration changed after verification.');
      const before = { ...identity }, receipt = nativeConfigurationTransition({ type: 'authority', reason: 'configuration', requestId: frame.id,
        method: selected.method, paramsHash: owned.paramsHash, resultHash, beforeConfiguration: before.configuration, identity: verified.identity },
      before, selected.method, frame.id, owned.paramsHash, resultHash);
      Object.assign(identity, receipt.identity);
      for (const [id, bound] of threads) if (sameNativeIdentity(bound, before)) threads.set(id, { ...identity });
      configuration = undefined; send(receipt); send({ id: frame.id, result: verified.result }); return true;
    }
    if (isNativeThreadContentMethod(selected.method)) {
      const owned = configuration;
      if (!owned?.content || owned.id !== frame.id || !owned.plan) throw new Error('Unowned thread content response.');
      await check();
      if (Object.hasOwn(frame, 'error')) {
        configuration = undefined; send({ id: frame.id, error: { code: -32603, message: 'Native thread content mutation failed.' } }); return true;
      }
      const result = await reviewThreadContent(owned.plan, frame.result); await check();
      if (configuration !== owned) throw new Error('Thread content response lost its owner.');
      if (selected.method === 'thread/goal/set') {
        if (result.goal?.status === 'active') goalAuthorities.add(selected.params.threadId); else goalAuthorities.delete(selected.params.threadId);
      }
      if (selected.method === 'thread/goal/clear') goalAuthorities.delete(selected.params.threadId);
      if (selected.method === 'thread/revert') loadedThreads.add(selected.params.threadId);
      configuration = undefined; send({ ...frame, result }); return true;
    }
    if (isNativeThreadLifecycleMethod(selected.method)) {
      const owned = configuration;
      if (!owned?.lifecycle || owned.id !== frame.id || !owned.plan) throw new Error('Unowned thread lifecycle response.');
      await check();
      if (Object.hasOwn(frame, 'error')) {
        configuration = undefined; send({ id: frame.id, error: { code: -32603, message: 'Native thread lifecycle failed.' } }); return true;
      }
      const result = await reviewThreadLifecycle(owned.plan, frame.result); await check();
      if (configuration !== owned) throw new Error('Thread lifecycle response lost its owner.');
      if (selected.method === 'thread/fork') {
        if (!nativeOwnedId(result.thread?.id) || threads.has(result.thread.id)) throw new Error('Invalid fork identity.');
        threads.set(result.thread.id, { ...identity }); loadedThreads.add(result.thread.id);
      }
      if (selected.method === 'thread/delete') for (const threadId of owned.plan.ids) {
        threads.delete(threadId); goalAuthorities.delete(threadId); goalTurns.delete(threadId);
      }
      configuration = undefined; send({ ...frame, result }); return true;
    }
    if (isNativeAccountReadMethod(selected.method)) {
      const owned = configuration;
      if (owned?.id !== frame.id || !owned.plan) throw new Error('Unowned account response.');
      await check();
      if (Object.hasOwn(frame, 'error')) {
        configuration = undefined; send({ id: frame.id, error: { code: -32603, message: 'Native account read failed.' } }); return true;
      }
      const result = await reviewAccountRead(owned.plan, frame.result); await check();
      if (configuration !== owned) throw new Error('Account read lost its owner.');
      configuration = undefined; send({ id: frame.id, result }); return true;
    }
    if (selected.method === nativeWindowsSandboxReadinessMethod) {
      await check();
      if (Object.hasOwn(frame, 'error')) { send({ id: frame.id, error: { code: -32603, message: 'Native Windows readiness query failed.' } }); return true; }
      const result = await reviewWindowsReadiness(selected.plan, frame.result); await check();
      send({ id: frame.id, result }); return true;
    }
    if (isNativePluginReadMethod(selected.method)) {
      const owned = configuration;
      if (!owned?.plugin || owned.id !== frame.id || !owned.plan) throw new Error('Unowned plugin response.');
      await check();
      if (Object.hasOwn(frame, 'error')) {
        configuration = undefined; send({ id: frame.id, error: { code: -32603, message: 'Native plugin read failed.' } }); return true;
      }
      const result = await reviewPluginRead(owned.plan, frame.result); await check();
      if (configuration !== owned) throw new Error('Plugin read lost its owner.');
      configuration = undefined; send({ id: frame.id, result }); return true;
    }
    if (isNativeStoredThreadReadMethod(selected.method) || isNativeConfigurationReadMethod(selected.method) || isNativeConfigurationControlMethod(selected.method)) {
      if (configuration?.id !== frame.id) throw new Error('Unowned configuration response.');
      await check();
      if (Object.hasOwn(frame, 'error')) { configuration = undefined; return false; }
      const review = isNativeStoredThreadReadMethod(selected.method) ? reviewStoredThreadRead : isNativeConfigurationReadMethod(selected.method) ? reviewConfigurationRead : reviewConfigurationControl;
      const result = await review(selected.method, selected.params, frame.result);
      await check(); configuration = undefined; send({ ...frame, result }); return true;
    }
    if (selected.method === nativeMcpOAuthMethod) {
      if (!mcpLogin || mcpLogin.id !== frame.id) throw new Error('Unowned MCP acknowledgement.');
      await check();
      if (Object.hasOwn(frame, 'error')) { mcpLogin = undefined; return false; }
      const acknowledged = mcpLogin.correlation.acknowledge(frame.result); send(frame);
      if (acknowledged.completion) { mcpLogin = undefined; send({ method: nativeMcpOAuthNotification, params: acknowledged.completion }); }
      return true;
    }
    if (selected.method === nativeMcpToolMethod) { await check(); tool = undefined; }
    if (Object.hasOwn(frame, 'error')) {
      if (frame.id === login?.id) login = undefined;
      if (frame.id === turn?.requestId) { turn = undefined; approvals.clear(); }
      return false;
    }
    const result = frame.result;
    if (selected.method === 'account/login/start') {
      if (!login || result?.type !== login.type) throw new Error('Invalid login acknowledgement.');
      if (login.type === 'apiKey') {
        nativeObject(result, ['type']); login.ack = true;
        if (login.early) { const early = login.early; delete login.early; login.completed = early.params.success; send(frame); send(early); return true; }
      }
      else {
        if (!nativeOwnedId(result.loginId)) throw new Error('Invalid login ID.');
        if (loginIds.size >= 64) throw new Error('Owned sign-in history limit.');
        login.loginId = result.loginId; loginIds.add(result.loginId);
        if (login.early) {
          const early = login.early; delete login.early;
          if (early.params.loginId !== login.loginId) throw new Error('Mismatched login completion.');
          login.completed = early.params.success;
          // Preserve acknowledgement-before-completion ordering on the wire.
          send(frame); send(early); return true;
        }
      }
    }
    if (selected.method === 'account/logout') { nativeObject(result, []); if (login?.type !== 'logout') throw new Error('Unowned sign-out reply.'); login.completed = true; }
    if (selected.method === 'account/login/cancel') {
      if (accountChanged || (await authority()).accountEpoch !== identity.accountEpoch) throw new Error('Cancelled account changed.');
      login = undefined;
    }
    if (selected.method === 'account/read' && allowAccountAuth) {
      await check();
      if (typeof reviewAccountMetadata !== 'function') throw new Error('Account metadata review is unavailable.');
      frame.result = await reviewAccountMetadata(result); await check();
    }
    if (selected.method === 'account/read' && login) {
      const expectedType = login.type === 'apiKey' ? 'apiKey' : 'chatgpt';
      const providerHidesAccount = allowAccountAuth && result?.requiresOpenaiAuth === false && result?.account == null;
      if (!login.completed || login.cancelled || (login.type === 'logout' ? result?.account != null : !providerHidesAccount && result?.account?.type !== expectedType)) throw new Error('Login is not complete.');
      const current = await check();
      if (!sameNativeIdentity(login.confirmationAuthority, current)) throw new Error('Account confirmation authority changed.');
      Object.assign(identity, current); threads.clear(); loadedThreads.clear(); goalAuthorities.clear(); goalTurns.clear(); login = undefined; accountChanged = false;
      send({ type: 'authority', identity: current });
    }
    if (selected.method === 'thread/start' || selected.method === 'thread/resume') {
      if (!nativeOwnedId(result?.thread?.id) || selected.method === 'thread/resume' && result.thread.id !== selected.params.threadId) throw new Error('Invalid native thread.');
      if (threads.size >= 64 && !threads.has(result.thread.id)) throw new Error('Native thread limit.');
      threads.set(result.thread.id, { ...identity });
      loadedThreads.add(result.thread.id);
      if (selected.params.approvalsReviewer === 'auto_review') {
        if (!allowGuardian || !['auto_review', 'guardian_subagent'].includes(result.approvalsReviewer)) throw new Error('Native reviewer did not match the granted selection.');
        guardianThreads.add(result.thread.id);
      } else {
        if (result.approvalsReviewer !== undefined && result.approvalsReviewer !== 'user') throw new Error('Native reviewer did not match the human selection.');
        guardianThreads.delete(result.thread.id);
      }
      if (selected.method === 'thread/resume' && allowThreadsWrite && typeof inspectThreadGoal === 'function') {
        // Goals may be disabled in this dedicated runtime. Failure to inspect
        // never grants authority to receive a background goal turn.
        let goal; try { goal = await inspectThreadGoal(result.thread.id); } catch { goal = null; }
        await check();
        if (goal?.goal?.status === 'active') goalAuthorities.add(result.thread.id); else goalAuthorities.delete(result.thread.id);
      }
    }
    if (selected.method === nativeThreadShellMethod) {
      if (!turn?.shell || turn.requestId !== frame.id) throw new Error('Unowned shell acknowledgement.');
      nativeObject(result, []); turn.ack = true;
      if (turn.terminal) { const terminal = turn.terminal; turn = undefined; approvals.clear(); send(frame); send(terminal); return true; }
    }
    if (selected.method === 'turn/start') {
      if (!turn || !nativeOwnedId(result?.turn?.id) || turn.id && turn.id !== result.turn.id) throw new Error('Invalid native turn.');
      turn.id = result.turn.id; turn.ack = true;
      if (turn.terminal) { const terminal = turn.terminal; turn = undefined; approvals.clear(); send(frame); send(terminal); return true; }
    }
    if (isNativeTurnWorkMethod(selected.method)) {
      if (!turn || turn.work !== selected.method || turn.requestId !== frame.id) throw new Error('Unowned review or compaction acknowledgement.');
      nativeTurnWorkAcknowledgement(selected.method, result, turn.threadId);
      if (selected.method === 'review/start') {
        if (turn.id && turn.id !== result.turn.id) throw new Error('Review acknowledged another turn.');
        turn.id = result.turn.id;
      }
      turn.ack = true;
      if (turn.reviewEarlyStart) { const early = turn.reviewEarlyStart; delete turn.reviewEarlyStart; await receive(early); }
      if (turn.terminal) { const terminal = turn.terminal; turn = undefined; approvals.clear(); send(frame); send(terminal); return true; }
    }
    return false;
  }
  function close() {
    if (configuration?.migration && configuration.context) { configuration.correlation?.close(); abortMigration(configuration.context); }
    if (login?.loginId) { try { write({ id: 'host_cancel_login', method: 'account/login/cancel', params: { loginId: login.loginId } }); } catch { /* Owned child shutdown still cancels the wait. */ } }
    if (turn?.id) { try { write({ id: 'host_interrupt_' + turn.id, method: 'turn/interrupt', params: { threadId: turn.threadId, turnId: turn.reviewDelegateId ?? turn.id } }); } catch { /* Child shutdown still revokes this owner. */ } }
    for (const [threadId, turnId] of goalTurns) { try { write({ id: 'host_goal_interrupt_' + turnId, method: 'turn/interrupt', params: { threadId, turnId } }); } catch { /* Owned child shutdown still revokes goals. */ } }
    goalAuthorities.clear(); goalTurns.clear();
    guardianReviews.clear(); guardianThreads.clear(); guardianApproval = undefined;
    requests.clear(); approvals.clear(); loadedThreads.clear(); login = undefined; turn = undefined; tool = undefined; mcpLogin = undefined; shell = undefined; configuration = undefined;
  }
  return { check, request, receive, close };
}
