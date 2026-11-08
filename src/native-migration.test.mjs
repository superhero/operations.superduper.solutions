// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { nativeRuntimeVersion, nativeRuntimeLimits } from './lib/native-runtime-contract.ts';
import { nativeConfigurationWriteHash } from './lib/native-configuration-write.ts';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { captureNativeMigrationPaths, nativeMigrationRepositoryScope, prepareNativeMigrationScopes, reviewNativeMigrationSources,
  readNativeMigrationJson, bindNativeMigrationReference } from '../companions/codex/migration-paths.mjs';
import { prepareNativeMigration, reviewNativeMigration } from '../companions/codex/migration.mjs';
import { nativeMigrationHistoryRow, nativeMigrationHistoryMarker, nativeMigrationStateDatabase } from '../companions/codex/migration-history.mjs';
import { nativeMigrationFixture } from '../tests/native-migration.fixture.mjs';
import { publicNativeMigrationResult } from './lib/secrets/native-migration.ts';
import { nativeCredentialSecrets, nativeCredentialTokens, validateNativePrivateValues } from './lib/secrets/native-credentials.ts';
import { redactor } from './lib/secrets/execution.ts';
import { nativeCommandReview } from './lib/secrets/native-command.ts';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { NativeReferenceContinuations } from './lib/secrets/native-reference-continuations.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { isNativePairedOperation } from './lib/native-account.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeMigrationMethods, nativeMigrationItemTypes, nativeMigrationParams as params, nativeMigrationInputSchema,
  nativeMigrationResult as migrationResult, NativeMigrationCorrelation, nativeMigrationProgress as progress, nativeMigrationCompleted as completed, nativeMigrationTransition } from './lib/native-migration.ts';

const kinds = ['AGENTS_MD', 'CONFIG', 'SKILLS', 'PLUGINS', 'MCP_SERVER_CONFIG', 'SUBAGENTS', 'HOOKS', 'COMMANDS', 'MEMORY', 'SESSIONS'];
const item = itemType => ({ itemType, description: 'Owned ' + itemType, cwd: null,
  details: itemType === 'MEMORY' ? { memory: ['project-memory.md'] } : null });
const request = (...types) => ({ migrationItems: types.map(item) });
const result = (importId, ...types) => ({ importId, itemTypeResults: types.map(itemType => ({ itemType, successes: [], failures: [] })) });
Before({ tags: '@native-migration' }, function () { this.migrationFixtures = []; this.migrationVaultFixtures = []; });
After({ tags: '@native-migration' }, async function () {
  for (const c of this.migrationVaultFixtures.reverse()) { c.v?.session.lock(); await c.f.close(); }
  for (const c of this.migrationFixtures.reverse()) { try { c.agent?.close(); await c.child?.close(); } finally { await rm(c.directory, { recursive: true, force: true }); } }
});
const sourceSecret = 'OWNED_MIGRATION_PROVIDER_SECRET_2486';
Then('migration requests without their complete independent grant never reach SDK preparation', async () => {
  for (const mode of ['agent-only', 'incomplete-migration']) {
    let prepared = 0;
    const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
    const callback = async () => { prepared++; throw new Error('Unexpected SDK migration dispatch'); };
    const agent = createCodexAgentSession({ identity, authority: async () => ({ ...identity }), send() {}, write() {}, threads: new Map(),
      allowAgent: true, allowMigration: mode === 'incomplete-migration', prepareMigration: callback, dispatchMigration: callback,
      reviewMigration: mode === 'incomplete-migration' ? undefined : callback, migrationAuthority: callback, finishMigration: callback, abortMigration: callback });
    try {
      for (const method of nativeMigrationMethods) await assert.rejects(agent.request({ id: 'owned_' + randomUUID(), method,
        params: method === 'externalAgentConfig/import' ? { migrationItems: [] } : method === 'externalAgentConfig/import/recordHistory' ? { providerId: 'owned-external', itemTypeResults: [] } : {} }));
      assert.equal(prepared, 0);
    } finally { agent.close(); }
  }
});
Then('migration models preserve all four native contracts graph persistence and named JSON fields', async () => {
  const source = await readServiceSchema('codex'), discovery = inspectServiceSchema(source, 'codex');
  for (const method of nativeMigrationMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.equal(isNativePairedOperation(method), true);
    assert.ok(!operation.capabilities.requirements.some(row => ['native-account', 'native-workspace', 'native-terminal'].includes(row.code)));
    assert.deepEqual(discovery.operations.find(row => row.id === operation.id).capabilities.requirements, operation.capabilities.requirements);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document);
    const workflow = { version: 3, id: 'migration-model-' + method.replaceAll('/', '_'), name: 'Native migration', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(workflow))), workflow);
    const input = method === 'externalAgentConfig/detect' ? { 'params:includeHome': 'true' }
      : method === 'externalAgentConfig/import' ? { 'params:migrationItems': JSON.stringify(request('AGENTS_MD').migrationItems) }
        : method === 'externalAgentConfig/import/recordHistory' ? { 'params:providerId': 'owned-external', 'params:itemTypeResults': '[]' } : {};
    const prepared = prepareNativeRequest(operation, input); assert.equal(prepared.protocol, 'json-rpc');
    assert.deepEqual(prepared.params, params(method, method === 'externalAgentConfig/detect' ? { includeHome: true }
      : method === 'externalAgentConfig/import' ? request('AGENTS_MD') : method === 'externalAgentConfig/import/recordHistory' ? { providerId: 'owned-external', itemTypeResults: [] } : {}));
    if (method === 'externalAgentConfig/import') assert.throws(() => prepareNativeRequest(operation, { 'params:migrationItems': '{broken' }), error => error.fieldKey === 'params:migrationItems');
  }
});
async function migrationVault(world, options = {}) {
  const c = { f: await nativeMigrationFixture(options), adopted: [] }; world.migrationVaultFixtures.push(c);
  c.f.transport.clear(); await waitForWatch(() => c.f.starts === c.f.stops);
  c.v = await nativeVaultFixture(c.f); c.selections = await c.v.workflowSelections();
  c.connection = await c.v.session.pairNativeRuntime(c.v.input, c.v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(row => row.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => c.v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, undefined,
    reference => { c.adopted.push(structuredClone(reference)); c.reference = reference; });
  return c;
}
Then('imported private values keep bounded ownership and distinguish metadata from content bytes', () => {
  const id = randomUUID(), stored = { [id]: [sourceSecret, '1', 'a.b'] };
  assert.deepEqual(validateNativePrivateValues(stored, [{ id }]), stored);
  const records = [{ value: 'OWNED_NATIVE_PAIRING_KEY_4286', nativePrivateValues: stored }];
  const secrets = nativeCredentialSecrets(records), tokens = nativeCredentialTokens(records);
  assert.ok(secrets.includes(sourceSecret)); assert.ok(!secrets.includes('1')); assert.ok(tokens.includes('1'));
  const review = nativeCommandReview(secrets, tokens, []), metadata = { hash: 'a1'.repeat(32), id, count: 1, description: '1 MCP server' };
  review.value(metadata); review.bytes(new TextEncoder().encode(JSON.stringify(metadata)));
  for (const text of ['token=1', 'Authorization: a.b', 'Bearer ' + sourceSecret]) {
    const scrub = redactor(secrets, tokens); assert.notEqual(scrub.text(text), text); assert.equal(scrub.changed, true);
  }
  const literal = redactor(secrets, tokens); assert.equal(literal.text('aXb'), 'aXb'); assert.equal(literal.changed, false);
  assert.throws(() => nativeCommandReview(secrets, tokens).bytes(new TextEncoder().encode('x1y')), error => error.code === 'REDACTED');
  for (const bad of [{ [randomUUID()]: ['unowned'] }, { [id]: new Array(1) }, { [id]: [''] }, { [id]: ['x'.repeat(8193)] }, { [id]: Array(257).fill('bounded') }])
    assert.throws(() => validateNativePrivateValues(bad, [{ id }]));
  let invoked = false; const accessor = {}; Object.defineProperty(accessor, id, { enumerable: true, get() { invoked = true; return ['private']; } });
  assert.throws(() => validateNativePrivateValues(accessor, [{ id }])); assert.equal(invoked, false);
});

Then('native migration metadata rejects malformed nested collections missing fields and oversized public results', () => {
  for (const input of [null, [], 1]) assert.throws(() => params('externalAgentConfig/import', input), /Use an object/);
  for (const migrationItems of [null, {}, Array(17).fill(item('CONFIG'))])
    assert.throws(() => params('externalAgentConfig/import', { migrationItems }), /Use an array/);
  assert.throws(() => params('externalAgentConfig/import', { migrationItems: [{}] }), /migrationItems\[0\].itemType: This field is required/);
  const sparse = new Array(1); sparse.extra = 'A field cannot replace a missing array position.';
  assert.throws(() => params('externalAgentConfig/detect', { cwds: sparse }), /cwds\[0\]/);
  assert.throws(() => params('unowned/migration', {}), error => error.field === 'method');
  assert.throws(() => migrationResult('unowned/migration', {}), error => error.field === 'method');
  assert.deepEqual(migrationResult('externalAgentConfig/import/recordHistory', { importId: 'owned_history' }), { importId: 'owned_history' });
  assert.throws(() => migrationResult('externalAgentConfig/import', { importId: 'unowned/import' }), error => error.field === 'importId');
  const oversized = { items: Array.from({ length: 40 }, () => ({ itemType: 'CONFIG', description: 'x'.repeat(2048) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > nativeRuntimeLimits.frame);
  assert.throws(() => migrationResult('externalAgentConfig/detect', oversized), error => error.field === 'result');
  for (const acknowledgement of [null, {}, { importId: 'owned', extra: true }])
    assert.throws(() => new NativeMigrationCorrelation(request('CONFIG')).acknowledge(acknowledgement), /migration lifecycle/);
});

Then('imported credential and reference continuation owners stay within their independent capacity limits', () => {
  const connections = Array.from({ length: 33 }, () => ({ id: randomUUID() }));
  const values = Object.fromEntries(connections.map(({ id }) => [id, []]));
  assert.throws(() => validateNativePrivateValues(values, connections), { code: 'INVALID' });
  const continuations = new NativeReferenceContinuations(), references = connections.map(({ id }) => ({ id, revision: 1, fingerprint: 'a'.repeat(64) }));
  for (const before of references) continuations.accept(before, { before, after: { ...before, revision: 2, fingerprint: 'b'.repeat(64) } });
  assert.deepEqual(continuations.resolve(references[0]), references[0], 'The oldest owner is removed when the cache exceeds 32 connections.');
  assert.deepEqual(continuations.resolve(references[1]), { ...references[1], revision: 2, fingerprint: 'b'.repeat(64) });
  assert.deepEqual(continuations.resolve(references.at(-1)), { ...references.at(-1), revision: 2, fingerprint: 'b'.repeat(64) });
});
Then('the private vault adopts imported values with fresh records and hides them across relock and removal', { timeout: 60000 }, async function () {
  let c;
  const basicPassword = 'OWNED_BASIC_PASSWORD_4628', urlPassword = 'OWNED_URL_PASSWORD_5729', queryToken = 'OWNED_QUERY_TOKEN_6830';
  c = await migrationVault(this, { beforeOpen: async f => {
    await writeFile(join(f.migrationHome, '.claude/settings.json'), JSON.stringify({ env: { OWNED_MIGRATION_SECRET: sourceSecret, OWNED_FLAG: '1' } }));
    await writeFile(join(f.migrationHome, '.mcp.json'), JSON.stringify({ mcpServers: { owned_http: {
      type: 'http', url: 'https://owned-user:' + urlPassword + '@127.0.0.1:9/mcp?token=' + queryToken,
      headers: { Authorization: 'Basic ' + Buffer.from('owned-basic:' + basicPassword).toString('base64') }
    } } }));
  }, beforeReview: async (_f, context) => {
    if (context.method === 'externalAgentConfig/import') await c.v.session.put(null, { label: 'Unrelated during native import', kind: 'secret', value: 'OWNED_UNRELATED_IMPORT_VALUE' });
  } });
  const original = structuredClone(c.reference), detected = (await c.execute('externalAgentConfig/detect', { includeHome: true })).response.result;
  const selected = detected.items.filter(item => ['AGENTS_MD', 'CONFIG', 'MCP_SERVER_CONFIG'].includes(item.itemType)); assert.equal(selected.length, 3);
  await c.execute('externalAgentConfig/import', { migrationItems: selected }); assert.ok(c.reference.revision > original.revision);
  const records = await c.v.session.records(), owner = records.find(row => row.id === c.v.keyId), values = owner.nativePrivateValues[c.reference.id];
  for (const value of [sourceSecret, '1', basicPassword, urlPassword, queryToken]) assert.ok(values.includes(value), 'Imported private fields must include ' + (value === '1' ? 'the short flag' : 'the owned credential fixture'));
  assert.ok((await c.v.session.list()).some(row => row.label === 'Unrelated during native import'));
  assert.equal(JSON.stringify(await c.v.session.list()).includes('nativePrivateValues'), false);
  assert.equal(JSON.stringify(await c.v.session.nativeConnections()).includes(sourceSecret), false);
  assert.equal(JSON.stringify(c.v.storage.state).includes(sourceSecret), false);
  await assert.rejects(c.v.session.executeNativeRuntime(original, c.selections, c.select('externalAgentConfig/detect'), {}), error => error.code === 'CONFLICT');
  const reference = structuredClone(c.reference); c.v.session.lock(); c.v.session = c.v.newSession(); await c.v.session.unlock(c.v.proof);
  assert.deepEqual(nativeReference((await c.v.session.nativeConnections())[0]), reference);
  assert.ok((await c.v.session.records()).find(row => row.id === c.v.keyId).nativePrivateValues[reference.id].includes(sourceSecret));
  await c.execute('externalAgentConfig/import/readHistories');
  await c.v.session.put(null, { id: c.v.keyId, label: 'Renamed native pairing key', kind: 'secret', value: c.f.key });
  assert.ok((await c.v.session.records()).find(row => row.id === c.v.keyId).nativePrivateValues[reference.id].includes(sourceSecret));
  await c.v.session.disconnectNativeRuntime(reference, true);
  assert.equal((await c.v.session.records()).find(row => row.id === c.v.keyId).nativePrivateValues, undefined);
});
Then('the private vault rejects cancelled revoked conflicting and newly private import acknowledgements', { timeout: 60000 }, async function () {
  for (const mode of ['cancel', 'source', 'cas', 'new-secret']) {
    let c, prepared = false, release; const held = new Promise(resolve => { release = resolve; });
    c = await migrationVault(this, { beforeReview: async (_f, context, result) => {
      if (context.method !== 'externalAgentConfig/import') return;
      if (mode === 'cancel' || mode === 'source') { prepared = true; await held; }
      if (mode === 'new-secret') await c.v.session.put(null, { label: 'Newly private import acknowledgement', kind: 'secret', value: result.importId });
      if (mode === 'cas') {
        const replace = c.v.storage.replace.bind(c.v.storage);
        c.v.storage.replace = async (...args) => { c.v.storage.state.revision++; c.v.storage.state.lockEpoch++; return replace(...args); };
      }
    } });
    const original = structuredClone(c.reference), controller = new AbortController();
    const pending = c.execute('externalAgentConfig/import', request('AGENTS_MD'), controller.signal); void pending.catch(() => {});
    if (mode === 'cancel' || mode === 'source') { await waitForWatch(() => prepared); if (mode === 'cancel') controller.abort(); else c.v.enabled = false; release(); }
    await assert.rejects(pending, mode === 'new-secret' ? error => error.code === 'REDACTED' : undefined);
    assert.deepEqual(c.reference, original); assert.equal(c.adopted.length, 0);
    assert.equal(c.f.frames.filter(frame => frame.method === 'externalAgentConfig/import').length, 1);
    assert.equal(await readFile(join(c.f.home, 'AGENTS.md'), 'utf8'), 'Owned private migration instructions.\n');
    await waitForWatch(() => c.f.starts === c.f.stops);
    if (mode === 'new-secret') assert.ok((await c.v.session.list()).some(row => row.label === 'Newly private import acknowledgement'));
  }
});
Then('verified imports retain a loaded thread and configured MCP calls in the same owned SDK child', { timeout: 60000 }, async function () {
  const c = await migrationVault(this, { withMcp: true });
  c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  const threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  const tool = message => c.execute('mcpServer/tool/call', { threadId, server: 'operations_fixture', tool: 'display_only', arguments: { message } });
  assert.ok(JSON.stringify((await tool('before owned import')).response.result).includes('before owned import'));
  const starts = c.f.starts;
  await c.execute('externalAgentConfig/import', request('AGENTS_MD', 'CONFIG'));
  assert.deepEqual((await c.execute('config/mcpServer/reload')).response.result, {});
  assert.ok(JSON.stringify((await tool('after owned import')).response.result).includes('after owned import'));
  assert.equal(c.f.starts, starts); assert.equal(c.f.starts - c.f.stops, 1);
  assert.ok(c.f.provider.requests.every(request => request.path.startsWith('/v1/models') && !request.hasAuthorization));
});
async function pathFixture(world) {
  const c = { directory: await mkdtemp('/tmp/native-migration-paths-') }; world.migrationFixtures.push(c);
  c.workspace = join(c.directory, 'workspace'); c.migrationHome = join(c.directory, 'private'); c.home = join(c.migrationHome, 'codex');
  for (const directory of [c.workspace, c.migrationHome, c.home, join(c.directory, '.git'), join(c.workspace, '.git'), join(c.workspace, 'nested'), join(c.migrationHome, '.claude')])
    await mkdir(directory, { mode: 0o700 });
  await writeFile(join(c.migrationHome, '.claude/settings.json'), JSON.stringify({ env: { SECRET: sourceSecret } }));
  await writeFile(join(c.workspace, 'nested/file.txt'), 'Owned repository file.');
  return c;
}
Then('migration scope preflight resolves files nested repositories and home attribution without granting history paths', async function () {
  const c = await pathFixture(this), file = join(c.workspace, 'nested/file.txt');
  assert.equal(await nativeMigrationRepositoryScope(file, c.workspace), c.workspace);
  assert.equal(await nativeMigrationRepositoryScope('nested/file.txt', c.workspace), c.workspace);
  const nested = join(c.workspace, 'nested'); await writeFile(join(nested, '.git'), 'gitdir: ../metadata-is-not-followed-by-migration\n');
  assert.equal(await nativeMigrationRepositoryScope(file, c.workspace), nested);
  const plan = await prepareNativeMigrationScopes('externalAgentConfig/detect', { includeHome: true, cwds: [file] }, c);
  assert.deepEqual(plan.params, { includeHome: true, cwds: [nested] }); assert.deepEqual(plan.scopes.map(s => s.cwd), [null, nested]);
  assert.equal(JSON.stringify(plan).includes(sourceSecret), false);
  const all = await prepareNativeMigrationScopes('externalAgentConfig/import', request(...kinds), c);
  assert.deepEqual(all.params.migrationItems.map(i => i.itemType), kinds); assert.equal(all.scopes.length, 1);
  const history = { providerId: 'opaque-product', itemTypeResults: [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG', cwd: '/external/metadata', source: '/external/source', target: '/external/target' }], failures: [] }] };
  const recorded = await prepareNativeMigrationScopes('externalAgentConfig/import/recordHistory', history, c);
  assert.deepEqual(recorded.params, history); assert.deepEqual(recorded.scopes, []); assert.deepEqual(recorded.sources, []);
  assert.deepEqual((await prepareNativeMigrationScopes('externalAgentConfig/import/readHistories', {}, c)).scopes, []);
  await rm(join(nested, '.git')); await rm(join(c.workspace, '.git'), { recursive: true }); await rm(join(c.directory, '.git'), { recursive: true });
  assert.equal(await nativeMigrationRepositoryScope(file, c.workspace), nested, 'Without an ancestor Git marker the SDK uses the supplied file parent');
});
Then('migration scopes reject ancestor repositories linked inputs and redirected native destinations', async function () {
  const c = await pathFixture(this), detect = () => prepareNativeMigrationScopes('externalAgentConfig/detect', { cwds: [c.workspace] }, c);
  await rm(join(c.workspace, '.git'), { recursive: true });
  await assert.rejects(detect, error => error.field === 'cwds' && /outside the paired workspace/.test(error.message));
  await mkdir(join(c.workspace, '.git'));
  const outside = join(c.directory, 'outside'); await mkdir(outside); await writeFile(join(outside, 'owned.txt'), sourceSecret);
  await symlink(outside, join(c.workspace, 'redirected'));
  await assert.rejects(() => nativeMigrationRepositoryScope(join(c.workspace, 'redirected/owned.txt'), c.workspace), error => error.field === 'cwd');
  await assert.rejects(() => nativeMigrationRepositoryScope(outside, c.workspace), error => error.field === 'cwd');
  await mkdir(join(c.workspace, '.codex')); await symlink(join(outside, 'owned.txt'), join(c.workspace, '.codex/hooks.json'));
  await assert.rejects(detect, error => error.field === 'cwds'); await rm(join(c.workspace, '.codex/hooks.json'));
  await link(join(outside, 'owned.txt'), join(c.workspace, 'AGENTS.md'));
  await assert.rejects(detect, error => error.field === 'cwds'); await rm(join(c.workspace, 'AGENTS.md'));
  await symlink(join(outside, 'owned.txt'), join(c.workspace, '.mcp.json'));
  await assert.rejects(detect, error => error.field === 'cwds'); await rm(join(c.workspace, '.mcp.json'));
  await symlink(join(outside, 'owned.txt'), join(c.migrationHome, '.claude.json'));
  await assert.rejects(detect, error => error.field === 'cwds'); await rm(join(c.migrationHome, '.claude.json'));
  await mkdir(join(c.workspace, '.claude')); await symlink(join(outside, 'owned.txt'), join(c.workspace, '.claude/source.json'));
  await assert.rejects(detect, error => error.field === 'cwds');
});
Then('migration source witnesses reject changed linked oversized and excessive files without returning their contents', async function () {
  const c = await pathFixture(this), args = { boundary: c.migrationHome, field: 'includeHome' };
  const plan = await prepareNativeMigrationScopes('externalAgentConfig/detect', { includeHome: true }, c); await reviewNativeMigrationSources(plan);
  const inventory = await captureNativeMigrationPaths(['.claude'], args); assert.equal(JSON.stringify(inventory).includes(sourceSecret), false);
  await writeFile(join(c.migrationHome, '.claude/settings.json'), JSON.stringify({ env: { SECRET: sourceSecret + '-changed' } }));
  await assert.rejects(() => reviewNativeMigrationSources(plan), error => error.field === 'includeHome');
  const capture = options => captureNativeMigrationPaths(['.claude'], { ...args, ...options });
  await assert.rejects(() => capture({ maximumEntries: 1 }), error => error.field === 'includeHome');
  await assert.rejects(() => capture({ maximumBytes: 1 }), error => error.field === 'includeHome');
  await assert.rejects(() => capture({ maximumFileBytes: 1 }), error => error.field === 'includeHome');
  await assert.rejects(() => capture({ maximumEntries: 4097 }), error => error.field === 'includeHome');
  await symlink(join(c.workspace, 'nested/file.txt'), join(c.migrationHome, '.claude/alias'));
  await assert.rejects(() => capture({}), error => error.field === 'includeHome'); await rm(join(c.migrationHome, '.claude/alias'));
  await link(join(c.workspace, 'nested/file.txt'), join(c.migrationHome, '.claude/shared'));
  await assert.rejects(() => capture({}), error => error.field === 'includeHome');
});
Then('migration scope preflight binds the actual SDK repository and verifies its unchanged source', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }); await mkdir(join(c.workspace, 'nested')); const file = join(c.workspace, 'nested/file.txt'); await writeFile(file, 'Owned input.');
  const detection = await c.runtime.prepareMigrationScopes('externalAgentConfig/detect', { cwds: [file] });
  assert.deepEqual(detection.params.cwds, [c.workspace]);
  const detected = await c.call('externalAgentConfig/detect', detection.params), instructions = detected.items.find(i => i.itemType === 'AGENTS_MD'); assert.ok(instructions);
  assert.equal(instructions.cwd, c.workspace);
  const plan = await c.runtime.prepareMigrationScopes('externalAgentConfig/import', { migrationItems: [instructions] });
  const imported = await c.import(plan.params); assert.ok(imported.terminal.itemTypeResults.every(r => r.failures.length === 0 && r.successes.length === 1));
  assert.equal(await readFile(join(c.workspace, 'AGENTS.md'), 'utf8'), 'Owned repository migration instructions.\n'); await c.runtime.reviewMigrationSources(plan);
  await writeFile(join(c.workspace, '.claude/CLAUDE.md'), 'Changed after scope inspection.\n');
  await assert.rejects(() => c.runtime.reviewMigrationSources(plan), error => error.field === 'migrationItems');
  await mkdir(join(c.workspace, '.codex')); await symlink(join(c.home, 'config.toml'), join(c.workspace, '.codex/hooks.json'));
  const frameCount = c.frames.length;
  await assert.rejects(() => c.runtime.prepareMigrationScopes('externalAgentConfig/import', { migrationItems: [instructions] }), error => error.field === 'migrationItems');
  assert.equal(c.frames.length, frameCount, 'A rejected preflight must not dispatch an SDK import');
});
Then('migration JSON readers and indirect references reject invalid escaped linked and changed sources', async function () {
  const c = await pathFixture(this), json = join(c.migrationHome, '.claude/settings.json'), args = { boundary: c.migrationHome };
  assert.equal((await readNativeMigrationJson(json, args)).env.SECRET, sourceSecret);
  assert.equal(await readNativeMigrationJson(join(c.migrationHome, 'absent.json'), args), undefined);
  await writeFile(json, ''); assert.equal(await readNativeMigrationJson(json, args), undefined);
  await writeFile(json, '{ invalid ' + sourceSecret);
  await assert.rejects(() => readNativeMigrationJson(json, args), error => error.field === 'migrationItems' && !error.message.includes(sourceSecret));
  await writeFile(json, Buffer.from([0xff, 0xfe])); await assert.rejects(() => readNativeMigrationJson(json, args), error => error.field === 'migrationItems');
  const plan = { sources: [] }, options = { ...c, relativeTo: c.workspace, field: 'migrationItems.plugins' };
  const local = await bindNativeMigrationReference(plan, 'nested/file.txt', options); await reviewNativeMigrationSources(plan);
  await writeFile(local, 'Changed source'); await assert.rejects(() => reviewNativeMigrationSources(plan), error => error.field === 'migrationItems');
  await assert.rejects(() => bindNativeMigrationReference(plan, c.directory, options), error => error.field === 'migrationItems');
  await assert.rejects(() => bindNativeMigrationReference(plan, c.home, options), error => error.field === 'migrationItems');
  await symlink(c.workspace, join(c.migrationHome, 'redirected'));
  await assert.rejects(() => bindNativeMigrationReference(plan, join(c.migrationHome, 'redirected/nested/file.txt'), options), error => error.field === 'migrationItems');
});
Then('migration effects reject missing history changed authority and unselected configuration namespaces', async function () {
  const c = await pathFixture(this), file = join(c.home, 'config.toml'); let user = {}, cli = { default_permissions: 'operations' }, histories = { data: [] };
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const environment = { ...c, capture: async () => ({ identity: { ...identity }, migrationBasis: 'owned-migration-basis' }),
    inspect: async () => ({ layers: [{ name: { type: 'user', file }, version: 'owned-user', config: structuredClone(user) },
      { name: { type: 'cli' }, version: 'owned-cli', config: structuredClone(cli) }] }), histories: async () => structuredClone(histories) };
  const context = await prepareNativeMigration('externalAgentConfig/import', request('CONFIG'), environment);
  user = { shell_environment_policy: { inherit: 'core', set: { SECRET: sourceSecret } } }; await writeFile(file, 'owned migrated configuration');
  const completion = { importId: 'owned-effect-import', itemTypeResults: [{ itemType: 'CONFIG', successes: [{ itemType: 'CONFIG', cwd: null, source: 'owned-source', target: file, title: null }], failures: [] }] };
  const ack = { importId: completion.importId };
  await assert.rejects(() => reviewNativeMigration(context, ack, completion), /persistent history/);
  histories = { data: [{ importId: completion.importId, providerId: 'owned-provider', successes: completion.itemTypeResults[0].successes, failures: [] }] };
  cli = { default_permissions: 'unowned' }; await assert.rejects(() => reviewNativeMigration(context, ack, completion), /configuration authority/); cli = { default_permissions: 'operations' };
  user.default_permissions = 'unowned'; await assert.rejects(() => reviewNativeMigration(context, ack, completion), /selected migration namespaces/); delete user.default_permissions;
  const priorAccount = identity.accountEpoch; identity.accountEpoch = randomUUID(); await assert.rejects(() => reviewNativeMigration(context, ack, completion), /account/); identity.accountEpoch = priorAccount;
  const verified = await reviewNativeMigration(context, ack, completion); assert.deepEqual(verified.result, ack); assert.ok(verified.effects.length); assert.deepEqual(verified.privateValues, [sourceSecret]);
  await writeFile(join(c.migrationHome, '.claude/settings.json'), '{}'); await assert.rejects(() => reviewNativeMigration(context, ack, completion), /source changed/);
});
Then('migration authority receipts reject foreign hashes identities and malformed private values', async () => {
  const before = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const inputHash = await nativeConfigurationWriteHash(request('AGENTS_MD')), resultHash = await nativeConfigurationWriteHash({ importId: 'owned-import' });
  const receipt = { type: 'authority', reason: 'migration', requestId: 'owned_migration', method: 'externalAgentConfig/import',
    paramsHash: inputHash, resultHash, effectHash: 'd'.repeat(64), beforeConfiguration: before.configuration,
    identity: { ...before, configuration: 'c'.repeat(64) }, privateValues: [sourceSecret] };
  const parse = value => nativeMigrationTransition(value, before, 'owned_migration', inputHash, resultHash);
  const accepted = parse(receipt); accepted.privateValues.push('separate clone'); assert.equal(receipt.privateValues.length, 1);
  for (const mutate of [p => p.requestId = 'foreign', p => p.method = 'externalAgentConfig/detect', p => p.paramsHash = '0'.repeat(64),
    p => p.resultHash = '0'.repeat(64), p => p.effectHash = 'invalid', p => p.beforeConfiguration = '0'.repeat(64),
    p => p.identity.accountEpoch = randomUUID(), p => p.identity.workspace = '0'.repeat(64), p => p.privateValues = new Array(1),
    p => p.privateValues = Array(257).fill('bounded'), p => p.privateValues = ['x'.repeat(8193)]]) {
    const changed = structuredClone(receipt); mutate(changed); assert.throws(() => parse(changed));
  }
});
Then('migration byte limits preserve the longest owned envelope and reject the next byte by name', () => {
  const input = { migrationItems: Array.from({ length: 16 }, () => ({ ...item('AGENTS_MD'), description: '' })) };
  const overhead = Buffer.byteLength(JSON.stringify(input)), capacity = nativeRuntimeLimits.frame - 512;
  for (let index = 0; index < 15; index++) input.migrationItems[index].description = '😀'.repeat(1024);
  const remaining = capacity - overhead - 15 * 4096; assert.ok(remaining > 0 && remaining < 4096);
  input.migrationItems[15].description = '😀'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4);
  const normalized = params('externalAgentConfig/import', input); assert.equal(Buffer.byteLength(JSON.stringify(normalized)), capacity);
  const envelope = { type: 'rpc', frame: { id: 'r'.repeat(128), method: 'externalAgentConfig/import', params: normalized } };
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= nativeRuntimeLimits.frame);
  input.migrationItems[15].description += 'x'; assert.throws(() => params('externalAgentConfig/import', input), error => error.field === 'params');
});
Then('migration rejects overwritten existing settings and escaped or aliased plugin databases', async function () {
  const c = await pathFixture(this), file = join(c.home, 'config.toml'); await writeFile(file, 'owned initial config');
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  let user = { shell_environment_policy: { inherit: 'core', set: { PRESERVE: 'owned-existing' } } };
  const environment = { ...c, capture: async () => ({ identity, migrationBasis: 'owned' }), histories: async () => ({ data: [] }),
    inspect: async () => ({ layers: [{ name: { type: 'user', file }, version: 'owned-user', config: structuredClone(user) }] }) };
  let context = await prepareNativeMigration('externalAgentConfig/import', request('CONFIG'), environment);
  user.shell_environment_policy.set.PRESERVE = 'changed';
  await assert.rejects(() => reviewNativeMigration(context, {}, {}), /existing shell environment/);
  user = { mcp_servers: { existing: { command: 'owned-original' } } };
  context = await prepareNativeMigration('externalAgentConfig/import', request('MCP_SERVER_CONFIG'), environment);
  user.mcp_servers.existing.command = 'changed'; await assert.rejects(() => reviewNativeMigration(context, {}, {}), /existing MCP server/);
  const plugin = { migrationItems: [{ ...item('PLUGINS'), details: { plugins: [] } }] };
  user = { sqlite_home: join(c.directory, 'outside') };
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', plugin, environment), /unowned SQLite home/);
  const sqlite = join(c.migrationHome, 'private-sqlite'); await mkdir(sqlite); await writeFile(join(c.directory, 'aliased.sqlite'), 'owned external data');
  await symlink(join(c.directory, 'aliased.sqlite'), join(sqlite, 'state_5.sqlite')); user = { sqlite_home: sqlite };
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', plugin, environment), error => error.field === 'migrationItems');
});
Then('migration history readers preserve the database and reject malformed rows identifiers and aliases', async function () {
  const c = await pathFixture(this), root = join(c.home, '.operations-migrations'); await mkdir(root, { mode: 0o700 });
  const path = join(root, nativeMigrationStateDatabase), database = new DatabaseSync(path);
  database.exec('CREATE TABLE external_agent_config_imports (import_id TEXT PRIMARY KEY, provider_id TEXT, completed_at_ms INTEGER, successes TEXT, failures TEXT)');
  database.prepare('INSERT INTO external_agent_config_imports VALUES (?, ?, ?, ?, ?)').run('owned_history', 'owned-provider', 1, JSON.stringify([{ item_type: 'CONFIG', source: 'owned-source' }]), '[]'); database.close();
  const bytes = await readFile(path), marker = await nativeMigrationHistoryMarker(root), row = await nativeMigrationHistoryRow(root, 'owned_history');
  assert.equal(marker, 1); assert.equal(row.importId, 'owned_history'); assert.equal(row.successes[0].itemType, 'CONFIG');
  assert.deepEqual(await readFile(path), bytes); assert.equal(await nativeMigrationHistoryRow(root, 'absent_history'), undefined);
  await assert.rejects(() => nativeMigrationHistoryRow(root, 'unowned\' SQL'), /identifier/);
  const malformed = new DatabaseSync(path); malformed.prepare('UPDATE external_agent_config_imports SET successes = ?').run('invalid ' + sourceSecret); malformed.close();
  await assert.rejects(() => nativeMigrationHistoryRow(root, 'owned_history'), error => !error.message.includes(sourceSecret));
  await rm(path); await writeFile(join(c.directory, 'outside-history.sqlite'), bytes); await symlink(join(c.directory, 'outside-history.sqlite'), path);
  await assert.rejects(() => nativeMigrationHistoryMarker(root), /unavailable/);
});
Then('plugin migration binds selected Claude and Cursor sources without following unused cache paths', async function () {
  const c = await pathFixture(this), claude = join(c.migrationHome, '.claude'), market = join(claude, 'owned-market');
  await mkdir(join(claude, 'plugins'), { recursive: true });
  await mkdir(join(market, '.agents/plugins'), { recursive: true }); await mkdir(join(market, 'plugins/owned-plugin'), { recursive: true });
  await writeFile(join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned-market', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './plugins/owned-plugin' } }] }));
  const declaration = { source: 'directory', path: './owned-market' }, obsolete = { source: 'directory', path: './obsolete-market' };
  const unused = join(c.directory, 'unused-outside-cache'), registry = { 'owned-market': { source: declaration, installLocation: unused } };
  await writeFile(join(claude, 'plugins/known_marketplaces.json'), JSON.stringify(registry));
  await writeFile(join(claude, 'settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'owned-market': { source: obsolete } } }));
  await writeFile(join(claude, 'settings.local.json'), JSON.stringify({ extraKnownMarketplaces: { 'owned-market': { source: declaration } } }));
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const environment = { ...c, capture: async () => ({ identity, migrationBasis: 'owned' }),
    inspect: async () => ({ layers: [{ name: { type: 'user', file: join(c.home, 'config.toml') }, version: 'owned', config: {} }] }) };
  const input = { migrationItems: [{ ...item('PLUGINS'), details: { plugins: [{ marketplaceName: 'owned-market', pluginNames: ['owned-plugin'] }] } }] };
  const plan = await prepareNativeMigration('externalAgentConfig/import', input, environment);
  assert.ok(plan.sources.some(source => source.paths.includes(market)));
  assert.ok(plan.sources.some(source => source.paths.includes(join(market, 'plugins/owned-plugin'))));
  assert.equal(JSON.stringify(plan).includes(unused), false); await reviewNativeMigrationSources(plan);
  const materialized = { source: 'settings', package: 'owned-package' };
  await writeFile(join(claude, 'plugins/known_marketplaces.json'), JSON.stringify({ 'owned-market': { source: materialized, installLocation: market } }));
  for (const name of ['settings.json', 'settings.local.json']) await writeFile(join(claude, name), JSON.stringify({ extraKnownMarketplaces: { 'owned-market': { source: materialized } } }));
  assert.ok((await prepareNativeMigration('externalAgentConfig/import', input, environment)).sources.some(source => source.paths.includes(market)));
  await writeFile(join(claude, 'settings.local.json'), JSON.stringify({ extraKnownMarketplaces: { 'owned-market': { source: { source: 'directory', path: unused } } } }));
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', input, environment), /leaves the paired workspace/);
  const cursor = join(c.migrationHome, '.cursor'), cursorMarket = join(cursor, 'plugins/marketplaces/owned-market');
  await mkdir(join(cursorMarket, '.cursor-plugin'), { recursive: true }); await mkdir(join(cursorMarket, 'plugins/owned-plugin'), { recursive: true });
  await mkdir(join(cursor, 'plugins/cache/owned-market/owned-plugin'), { recursive: true });
  await writeFile(join(cursorMarket, '.cursor-plugin/marketplace.json'), JSON.stringify({ name: 'owned-market', plugins: [
    { name: 'owned-plugin', source: 'plugins/owned-plugin' }, { name: 'unused-plugin', source: unused }] }));
  const cursorPlan = await prepareNativeMigration('externalAgentConfig/import', { ...input, migrationSource: 'cursor' }, environment);
  assert.ok(cursorPlan.sources.some(source => source.paths.includes(join(cursorMarket, 'plugins/owned-plugin'))));
  await writeFile(join(cursorMarket, 'plugins/owned-plugin/changed.md'), 'Changed owned plugin');
  await assert.rejects(() => reviewNativeMigrationSources(cursorPlan), /source changed/);
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', { migrationItems: [{ ...input.migrationItems[0], cwd: c.workspace }] }, environment), /Repository-scoped plugin/);
});
Then('configured plugin sources bind native caches and reject escaped or changed marketplace paths', async function () {
  const c = await pathFixture(this), market = join(c.workspace, 'configured-market');
  await mkdir(join(market, '.agents/plugins'), { recursive: true }); await mkdir(join(market, 'plugins/owned-plugin'), { recursive: true });
  const manifest = { name: 'owned-configured', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './plugins/owned-plugin' } }] };
  await writeFile(join(market, '.agents/plugins/marketplace.json'), JSON.stringify(manifest));
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion, configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  let marketplaces = { configured: { source_type: 'local', source: market } };
  const environment = { ...c, capture: async () => ({ identity, migrationBasis: 'owned' }),
    inspect: async () => ({ layers: [{ name: { type: 'user', file: join(c.home, 'config.toml') }, version: 'owned', config: { marketplaces } }] }) };
  const input = { migrationItems: [{ ...item('PLUGINS'), details: { plugins: [{ marketplaceName: manifest.name, pluginNames: ['owned-plugin'] }] } }] };
  const plan = await prepareNativeMigration('externalAgentConfig/import', input, environment);
  assert.ok(plan.sources.some(source => source.paths.includes(market))); await reviewNativeMigrationSources(plan);
  await writeFile(join(market, 'plugins/owned-plugin/changed.md'), 'Changed owned source');
  await assert.rejects(() => reviewNativeMigrationSources(plan), /source changed/);
  await mkdir(join(c.workspace, '.agents/plugins'), { recursive: true });
  await writeFile(join(c.workspace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'repository-fallback', plugins: [] }));
  marketplaces = { fallback: { source_type: 'local', source: join(c.workspace, 'nested') } };
  assert.ok(!(await prepareNativeMigration('externalAgentConfig/import', input, environment)).sources.some(source => source.paths.includes(c.workspace)), 'An ignored root must not widen into its ancestor repository');
  marketplaces = { unselected: { source_type: 'local', source: c.directory } };
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', input, environment), /configured marketplace leaves/);
  const cache = join(c.home, '.tmp/marketplaces/owned-cache');
  await mkdir(join(cache, '.agents/plugins'), { recursive: true }); await writeFile(join(cache, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned-cache', plugins: [] }));
  marketplaces = { 'owned-cache': { source_type: 'git', source: 'example/owned-fixture' } };
  assert.ok((await prepareNativeMigration('externalAgentConfig/import', input, environment)).sources.some(source => source.paths.includes(cache)));
  await rm(cache, { recursive: true }); await symlink(market, cache);
  await assert.rejects(() => prepareNativeMigration('externalAgentConfig/import', input, environment), error => error.field === 'migrationItems');
});
Then('migration results withhold session derived text and native failures without accepting extra fields', () => {
  const connectors = [{ name: 'owned_connector', sessionCount: 1, source: 'sessionToolUse' }];
  const detect = { connectors, items: [{ itemType: 'SESSIONS', cwd: null, description: sourceSecret,
    details: { sessions: [{ cwd: '/owned/workspace', path: '/owned/private/session.jsonl', title: sourceSecret }] } }] };
  const projected = publicNativeMigrationResult('externalAgentConfig/detect', detect);
  assert.equal(projected.items[0].details.sessions[0].title, null); assert.equal(projected.items[0].description, 'Local sessions');
  assert.deepEqual(projected.connectors, connectors);
  assert.equal(detect.items[0].details.sessions[0].title, sourceSecret); assert.equal(JSON.stringify(projected).includes(sourceSecret), false);
  const history = { connectors: [{ ...connectors[0], source: 'remoteMcpServersConfig' }], data: [{ importId: 'owned_history', completedAtMs: 1, providerId: null,
    successes: [{ itemType: 'SESSIONS', target: 'external-thread-metadata', title: sourceSecret }],
    failures: [{ itemType: 'CONFIG', failureStage: 'config_parse', message: sourceSecret }] }] };
  const safe = publicNativeMigrationResult('externalAgentConfig/import/readHistories', history);
  assert.equal(JSON.stringify(safe).includes(sourceSecret), false); assert.equal(safe.data[0].successes[0].target, 'external-thread-metadata');
  assert.equal(safe.data[0].failures[0].failureStage, 'config_parse');
  assert.deepEqual(publicNativeMigrationResult('externalAgentConfig/import', { importId: 'owned_history' }), { importId: 'owned_history' });
  for (const bad of [{ ...detect, privateConfig: sourceSecret }, { items: [{ ...detect.items[0], credential: sourceSecret }] },
    { items: [{ ...detect.items[0], details: { sessions: [{ cwd: '/owned', path: 'source', privateTranscript: sourceSecret }] } }] }])
    assert.throws(() => publicNativeMigrationResult('externalAgentConfig/detect', bad), error => error.code === 'NATIVE_CONTRACT' && !error.message.includes(sourceSecret));
  let invoked = false; const accessor = { get items() { invoked = true; return []; } };
  assert.throws(() => publicNativeMigrationResult('externalAgentConfig/detect', accessor)); assert.equal(invoked, false);
});
Then('the private broker withholds actual native session titles and persisted failure contents', { timeout: 60000 }, async function () {
  let privateTitleObserved = false;
  const f = await nativeMigrationFixture({ beforeReview(_f, context, result) {
    if (context.method === 'externalAgentConfig/detect') privateTitleObserved = JSON.stringify(result).includes(sourceSecret);
  } });
  try {
    const project = join(f.migrationHome, '.claude/projects/owned-project'); await mkdir(project, { recursive: true });
    const lines = ['user', 'assistant'].map(type => ({ type, cwd: f.workspace, timestamp: new Date().toISOString(), message: { content: sourceSecret + ' private conversation' } }));
    await writeFile(join(project, randomUUID() + '.jsonl'), lines.map(row => JSON.stringify(row)).join('\n') + '\n');
    const detected = await f.execute('externalAgentConfig/detect', { includeHome: true, maxSessions: 8 });
    assert.ok(detected.items.find(item => item.itemType === 'SESSIONS').details.sessions.length > 0); assert.equal(JSON.stringify(detected).includes(sourceSecret), false);
    assert.equal(privateTitleObserved, true, 'The native detection result must contain real transcript-derived fixture text before projection');
    const ack = await f.execute('externalAgentConfig/import/recordHistory', { providerId: 'owned-external-private', itemTypeResults: [
      { itemType: 'SESSIONS', successes: [{ itemType: 'SESSIONS', title: sourceSecret }], failures: [] },
      { itemType: 'CONFIG', successes: [], failures: [{ itemType: 'CONFIG', failureStage: 'config_parse', message: sourceSecret }] }] });
    const stored = await nativeMigrationHistoryRow(join(f.home, '.operations-migrations'), ack.importId);
    assert.equal(stored.successes[0].title, sourceSecret); assert.equal(stored.failures[0].message, sourceSecret);
    const history = await f.execute('externalAgentConfig/import/readHistories', {}); assert.ok(history.data.some(row => row.importId === ack.importId));
    assert.equal(JSON.stringify(history).includes(sourceSecret), false);
    assert.ok(f.frames.some(frame => frame.method === 'externalAgentConfig/import/recordHistory' && JSON.stringify(frame.params).includes(sourceSecret)), 'The SDK must actually persist the private fixture text');
  } finally { await f.close(); }
});
Then('the pinned SDK imports an owned configured marketplace without reading its unused provider cache', { timeout: 60000 }, async function () {
  let market, unused;
  const c = await sdkFixture(this, { isolated: true, beforeOpen: async c => {
    market = join(c.workspace, 'configured-market'); unused = join(c.directory, 'unused-market');
    await mkdir(join(market, '.agents/plugins'), { recursive: true }); await mkdir(join(market, 'plugins/owned-plugin/.codex-plugin'), { recursive: true }); await mkdir(unused);
    await writeFile(join(unused, 'unselected-private.md'), sourceSecret);
    await writeFile(join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned-configured', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './plugins/owned-plugin' } }] }));
    await writeFile(join(market, 'plugins/owned-plugin/.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '0.1.0', description: 'Owned configured migration plugin' }));
    await mkdir(join(c.sourceHome, '.claude/plugins'), { recursive: true });
    await writeFile(join(c.sourceHome, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'owned-configured': { source: { source: 'directory', path: unused }, installLocation: unused } }));
    await writeFile(join(c.home, 'config.toml'), await readFile(join(c.home, 'config.toml'), 'utf8') + '[features]\nplugins=true\n[marketplaces.owned-configured]\nsource_type="local"\nsource=' + JSON.stringify(market) + '\n');
  } });
  const input = { migrationItems: [{ ...item('PLUGINS'), details: { plugins: [{ marketplaceName: 'owned-configured', pluginNames: ['owned-plugin'] }] } }] };
  const plan = await c.runtime.prepareMigration('externalAgentConfig/import', input);
  assert.ok(plan.sources.some(source => source.paths.includes(market))); assert.ok(!plan.sources.some(source => source.paths.includes(unused)));
  await c.runtime.dispatchMigration(plan); const imported = await c.import(plan.params), verified = await c.runtime.reviewMigration(plan, imported.ack, imported.terminal);
  assert.deepEqual(imported.terminal.itemTypeResults[0].failures, []); assert.ok(imported.terminal.itemTypeResults[0].successes.length > 0);
  assert.ok(verified.effects.some(effect => effect.path.startsWith(join(c.home, 'plugins'))));
  assert.equal(JSON.stringify(imported).includes(sourceSecret), false); c.runtime.finishMigration(plan);
});
Then('the pinned SDK imports a Cursor cached marketplace through the owned effect verifier', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true, beforeOpen: async c => {
    const cursor = join(c.sourceHome, '.cursor'), market = join(cursor, 'plugins/marketplaces/owned-cursor');
    await mkdir(join(market, '.cursor-plugin'), { recursive: true }); await mkdir(join(market, 'plugins/owned-plugin/.cursor-plugin'), { recursive: true });
    await mkdir(join(cursor, 'plugins/cache/owned-cursor/owned-plugin'), { recursive: true });
    await writeFile(join(market, '.cursor-plugin/marketplace.json'), JSON.stringify({ name: 'owned-cursor', plugins: [{ name: 'owned-plugin', source: 'plugins/owned-plugin' }] }));
    await writeFile(join(market, 'plugins/owned-plugin/.cursor-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '0.1.0', description: 'Owned Cursor plugin fixture' }));
    await writeFile(join(c.home, 'config.toml'), await readFile(join(c.home, 'config.toml'), 'utf8') + '[features]\nplugins=true\n');
  } });
  const detected = await c.call('externalAgentConfig/detect', { includeHome: true, migrationSource: 'cursor' });
  const selected = detected.items.filter(item => item.itemType === 'PLUGINS'); assert.equal(selected.length, 1);
  const plan = await c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: selected, migrationSource: 'cursor', providerId: 'owned-cursor' });
  await c.runtime.dispatchMigration(plan); const imported = await c.import(plan.params), verified = await c.runtime.reviewMigration(plan, imported.ack, imported.terminal);
  assert.equal(imported.terminal.itemTypeResults[0].failures.length, 0); assert.ok(imported.terminal.itemTypeResults[0].successes.length > 0);
  assert.ok(verified.effects.length > 0); assert.notEqual(verified.identity.configuration, plan.before.identity.configuration);
  const installed = (await readdir(join(c.home, 'plugins'), { recursive: true })).filter(path => path.endsWith('/plugin.json'));
  assert.ok(installed.length > 0); assert.ok((await Promise.all(installed.map(path => readFile(join(c.home, 'plugins', path), 'utf8')))).some(value => JSON.parse(value).name === 'owned-plugin'));
  c.runtime.finishMigration(plan);
});
Then('the private migration broker accepts all four methods and holds its owner through verified adoption', { timeout: 60000 }, async function () {
  const f = await nativeMigrationFixture();
  try {
    const detected = await f.execute('externalAgentConfig/detect', { includeHome: true });
    const input = { migrationItems: detected.items.filter(item => ['AGENTS_MD', 'CONFIG'].includes(item.itemType)) };
    let release, adopting = false, returned = false; const held = new Promise(resolve => { release = resolve; }), before = { ...f.connection.identity }, notices = [];
    const pending = f.execute('externalAgentConfig/import', input, async (receipt, ack) => {
      assert.notEqual(receipt.identity.configuration, before.configuration); assert.ok(receipt.privateValues.includes(sourceSecret));
      assert.equal(receipt.resultHash, await nativeConfigurationWriteHash(ack)); adopting = true; await held;
      f.connection.identity = { ...receipt.identity };
    }, undefined, async () => {}, value => notices.push(value)).then(result => { returned = true; return result; }); void pending.catch(() => {});
    await waitForWatch(() => adopting); assert.equal(returned, false);
    await assert.rejects(f.execute('externalAgentConfig/detect', {}), error => error.code === 'CONFLICT'); release();
    const ack = await pending; assert.deepEqual(Object.keys(ack), ['importId']); assert.equal(JSON.stringify(ack).includes(sourceSecret), false); assert.deepEqual(notices, []);
    const history = await f.execute('externalAgentConfig/import/readHistories', {}); assert.ok(history.data.some(row => row.importId === ack.importId));
    const identity = { ...f.connection.identity };
    const recorded = await f.execute('externalAgentConfig/import/recordHistory', { providerId: 'owned-external', itemTypeResults: [] }); assert.ok(recorded.importId);
    assert.deepEqual(f.connection.identity, identity); assert.equal(f.starts, 2); assert.equal(f.stops, 1);
  } finally { await f.close(); }
});
Then('the private migration broker rejects missing duplicate tampered and unsolicited authority receipts', { timeout: 60000 }, async function () {
  for (const mode of ['missing', 'duplicate', 'input', 'result', 'ack', 'account', 'unsolicited']) {
    let adopted = false;
    const f = await nativeMigrationFixture({ mutateFrame(frame) {
      if (frame.type === 'authority' && frame.reason === 'migration') {
        if (mode === 'missing') return [];
        if (mode === 'duplicate') return [frame, structuredClone(frame)];
        if (mode === 'input') frame.paramsHash = 'f'.repeat(64);
        if (mode === 'result') frame.resultHash = 'f'.repeat(64);
        if (mode === 'account') frame.identity.accountEpoch = randomUUID();
      }
      if (mode === 'ack' && frame.result?.importId) frame.result.importId = 'unowned-result';
      if (mode === 'unsolicited' && frame.result?.items) return [{ type: 'authority', reason: 'migration', identity: {} }, frame];
      return [frame];
    } });
    try {
      if (mode === 'unsolicited') await assert.rejects(f.execute('externalAgentConfig/detect', { includeHome: true }));
      else {
        await assert.rejects(f.execute('externalAgentConfig/import', request('AGENTS_MD'), async () => { adopted = true; }));
        assert.equal(f.frames.filter(frame => frame.method === 'externalAgentConfig/import').length, 1, 'Receipt rejection must follow a real SDK dispatch');
        assert.equal(await readFile(join(f.home, 'AGENTS.md'), 'utf8'), 'Owned private migration instructions.\n');
      }
      assert.equal(adopted, false); await waitForWatch(() => f.starts === f.stops);
    } finally { await f.close(); }
  }
});
Then('the pinned SDK imports all ten native migration kinds and persists their completion history', { timeout: 60000 }, async function () {
  const transcript = 'OWNED_PRIVATE_MIGRATION_TRANSCRIPT_1379';
  const c = await sdkFixture(this, { isolated: true, beforeOpen: async c => {
    const source = join(c.sourceHome, '.claude'), market = join(source, 'plugins/marketplaces/owned-market');
    for (const path of ['skills/owned-skill', 'commands', 'agents', 'hooks', 'projects/owned-project/memory',
      'plugins/marketplaces/owned-market/.agents/plugins', 'plugins/marketplaces/owned-market/plugins/owned-plugin/.codex-plugin']) await mkdir(join(source, path), { recursive: true });
    const settings = { env: { OWNED_MIGRATION_SECRET: sourceSecret },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/owned.sh"' }] }] },
      enabledPlugins: { 'owned-plugin@owned-market': true } };
    await writeFile(join(source, 'settings.json'), JSON.stringify(settings));
    await writeFile(join(c.sourceHome, '.mcp.json'), JSON.stringify({ mcpServers: { owned_mcp: { command: '/bin/true', env: { OWNED_MCP_SECRET: sourceSecret } } } }));
    await writeFile(join(source, 'skills/owned-skill/SKILL.md'), '---\nname: owned-skill\ndescription: Owned migration skill\n---\nReview local changes.\n');
    await writeFile(join(source, 'commands/owned-command.md'), '---\ndescription: Owned migration command\n---\nReview local files.\n');
    await writeFile(join(source, 'agents/owned-agent.md'), '---\nname: owned-agent\ndescription: Owned migration agent\n---\nReview local files.\n');
    await writeFile(join(source, 'hooks/owned.sh'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(source, 'projects/owned-project/memory/MEMORY.md'), 'Owned project-scoped migration memory.\n');
    const records = ['user', 'assistant'].map((type, index) => ({ type, cwd: c.workspace, timestamp: new Date().toISOString(), message: { content: index ? 'Owned local history reply.' : transcript } }));
    await writeFile(join(source, 'projects/owned-project', randomUUID() + '.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
    await writeFile(join(source, 'plugins/known_marketplaces.json'), JSON.stringify({ 'owned-market': { source: { source: 'directory', path: market }, installLocation: market } }));
    await writeFile(join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned-market', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './plugins/owned-plugin' } }] }));
    await writeFile(join(market, 'plugins/owned-plugin/.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '0.1.0', description: 'Owned native plugin fixture' }));
    await writeFile(join(c.home, 'config.toml'), await readFile(join(c.home, 'config.toml'), 'utf8') + '[features]\nplugins=true\nexternal_agent_memory_import=true\n');
  } });
  const scope = await c.runtime.prepareMigrationScopes('externalAgentConfig/detect', { includeHome: true, maxSessions: 8 });
  const detected = await c.call('externalAgentConfig/detect', scope.params);
  assert.deepEqual([...new Set(detected.items.map(item => item.itemType))].sort(), [...kinds].sort(), 'The SDK fixture must offer every original migration kind');
  const plan = await c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: detected.items, providerId: 'owned-all-kinds', migrationSource: 'claude' });
  await c.runtime.dispatchMigration(plan);
  const imported = await c.import(plan.params), verified = await c.runtime.reviewMigration(plan, imported.ack, imported.terminal);
  assert.ok(verified.effects.length > 0); assert.ok(verified.privateValues.includes(sourceSecret));
  assert.notEqual(verified.identity.configuration, plan.before.identity.configuration);
  c.runtime.finishMigration(plan);
  assert.deepEqual(imported.terminal.itemTypeResults.map(result => result.itemType).sort(), [...kinds].sort());
  assert.deepEqual(imported.terminal.itemTypeResults.map(result => ({ itemType: result.itemType, failures: result.failures.map(failure => ({ failureStage: failure.failureStage, errorType: failure.errorType })) })).filter(result => result.failures.length), []);
  assert.ok(imported.terminal.itemTypeResults.every(result => result.successes.length > 0), 'Every kind must produce an actual successful import');
  assert.ok((await readFile(join(c.home, 'config.toml'), 'utf8')).includes(sourceSecret));
  assert.equal(await readFile(join(c.home, 'AGENTS.md'), 'utf8'), 'Owned global migration instructions.\n');
  assert.ok((await readFile(join(c.privateRoot, '.agents/skills/owned-skill/SKILL.md'), 'utf8')).includes('owned-skill'));
  const command = imported.terminal.itemTypeResults.find(result => result.itemType === 'COMMANDS').successes[0];
  const commandTarget = await captureNativeMigrationPaths([join(command.target, 'SKILL.md')], { boundary: join(c.privateRoot, '.agents/skills') });
  const commandFile = commandTarget.entries.find(entry => entry.kind === 'file'); assert.ok(commandFile);
  assert.ok((await readFile(commandFile.path, 'utf8')).includes('Review local files'));
  assert.ok((await readFile(join(c.home, 'agents/owned-agent.toml'), 'utf8')).includes('owned-agent'));
  assert.ok((await readFile(join(c.home, 'hooks.json'), 'utf8')).includes('SessionStart'));
  assert.equal(await readFile(join(c.home, 'memories/extensions/external_agent_import/resources/owned-project/MEMORY.md'), 'utf8'), 'Owned project-scoped migration memory.\n');
  const history = await c.call('externalAgentConfig/import/readHistories', null), row = history.data.find(row => row.importId === imported.ack.importId);
  assert.ok(row); assert.deepEqual([...new Set(row.successes.map(success => success.itemType))].sort(), [...kinds].sort()); assert.deepEqual(row.failures, []);
  const user = (await c.runtime.inspectConfiguration()).layers.find(layer => layer.name.type === 'user').config;
  assert.ok(user.mcp_servers.owned_mcp); assert.ok(Object.keys(user.plugins).some(name => name.includes('owned-plugin')));
  const homeFiles = await readdir(c.home, { recursive: true });
  const pluginFiles = homeFiles.filter(path => path.endsWith('/.codex-plugin/plugin.json'));
  assert.ok(pluginFiles.length > 0, 'The plugin must be installed inside the private Codex home');
  assert.ok((await Promise.all(pluginFiles.map(path => readFile(join(c.home, path), 'utf8')))).some(text => JSON.parse(text).name === 'owned-plugin'));
  const hookFiles = homeFiles.filter(path => path.endsWith('/owned.sh')); assert.equal(hookFiles.length, 1);
  assert.equal(await readFile(join(c.home, hookFiles[0]), 'utf8'), '#!/bin/sh\nexit 0\n');
  const sessions = (await readdir(join(c.home, 'sessions'), { recursive: true })).filter(path => path.endsWith('.jsonl'));
  assert.equal(sessions.length, 1); assert.ok((await readFile(join(c.home, 'sessions', sessions[0]), 'utf8')).includes(transcript));
  assert.equal(JSON.stringify(c.frames).includes(sourceSecret), false, 'Native migration metadata must not echo the imported environment credentials');
  await writeFile('tmp/test/native-migration-effect-proof.json', JSON.stringify({ capturedAt: Date.now(), importId: imported.ack.importId,
    itemTypes: imported.terminal.itemTypeResults.map(result => result.itemType).sort(), successesByKind: Object.fromEntries(imported.terminal.itemTypeResults.map(result => [result.itemType, result.successes.length])),
    historyKinds: [...new Set(row.successes.map(success => success.itemType))].sort(), pluginFiles, hookFiles, sessionFiles: sessions,
    commandSkillDirectory: command.target, sourceWitnessStable: true, configurationCredentialEchoed: false,
    hostVerified: true, effectHash: verified.effectHash, configurationChanged: verified.identity.configuration !== plan.before.identity.configuration }, null, 2) + '\n');
});
Then('migrated sandbox preferences retain the fixed runtime profile and deny tool reads of the private home', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true, allowCommands: true, beforeOpen: async c => {
    await writeFile(join(c.sourceHome, '.claude/settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
    await writeFile(join(c.workspace, 'owned-public.txt'), 'Owned permitted content.\n');
    await writeFile(join(c.home, 'owned-private.txt'), sourceSecret, { mode: 0o600 });
  } });
  const before = await c.runtime.inspectConfiguration(), detected = await c.call('externalAgentConfig/detect', { includeHome: true });
  const selected = detected.items.filter(item => item.itemType === 'CONFIG'); assert.equal(selected.length, 1);
  const imported = await c.import({ migrationItems: selected }); assert.ok(imported.terminal.itemTypeResults.every(result => result.failures.length === 0 && result.successes.length === 1));
  const after = await c.runtime.inspectConfiguration();
  assert.deepEqual(after.layers.filter(layer => layer.name.type !== 'user'), before.layers.filter(layer => layer.name.type !== 'user'));
  assert.deepEqual(after.config.permissions, before.config.permissions); assert.equal(after.config.default_permissions, before.config.default_permissions);
  const user = after.layers.find(layer => layer.name.type === 'user').config; assert.equal(user.sandbox_mode, 'workspace-write');
  const read = async path => c.call('command/exec', { command: ['/bin/cat', path], cwd: c.workspace, timeoutMs: 10000, outputBytesCap: 4096 });
  const publicResult = await read(join(c.workspace, 'owned-public.txt')); assert.equal(publicResult.exitCode, 0); assert.equal(publicResult.stdout, 'Owned permitted content.\n');
  const privateResult = await read(join(c.home, 'owned-private.txt')); assert.notEqual(privateResult.exitCode, 0); assert.equal(privateResult.stdout.includes(sourceSecret), false);
});
Then('a verified instruction import advances file effect identity and rejects completed context replay', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }), detected = await c.call('externalAgentConfig/detect', { includeHome: true });
  const selected = detected.items.filter(item => item.itemType === 'AGENTS_MD'), before = await c.runtime.authority(), config = await readFile(join(c.home, 'config.toml'), 'utf8');
  const context = await c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: selected });
  await assert.rejects(() => c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: selected }), /busy/);
  const input = await c.runtime.dispatchMigration(context), imported = await c.import(input), verified = await c.runtime.reviewMigration(context, imported.ack, imported.terminal);
  assert.equal(await readFile(join(c.home, 'config.toml'), 'utf8'), config);
  assert.notEqual(verified.identity.configuration, before.configuration); assert.deepEqual({ ...verified.identity, configuration: before.configuration }, before);
  assert.deepEqual(await c.runtime.migrationAuthority(context), verified.identity); c.runtime.finishMigration(context);
  await assert.rejects(() => c.runtime.migrationAuthority(context), /Unowned/); c.runtime.abortMigration(context);
  assert.deepEqual(await c.runtime.authority(), verified.identity);
});
Then('owned migration metadata methods and empty imports preserve file and credential authority', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }), before = await c.runtime.authority();
  async function call(method, params) {
    const context = await c.runtime.prepareMigration(method, params), input = await c.runtime.dispatchMigration(context);
    const result = await c.call(method, input), verified = await c.runtime.reviewMigration(context, result);
    assert.deepEqual(verified.identity, before); assert.deepEqual(verified.privateValues, []); assert.deepEqual(verified.effects, []);
    c.runtime.finishMigration(context); return result;
  }
  const detected = await call('externalAgentConfig/detect', { includeHome: true }); assert.ok(detected.items.some(item => item.itemType === 'CONFIG'));
  await call('externalAgentConfig/import/recordHistory', { providerId: 'owned-external-history', itemTypeResults: [{ itemType: 'SESSIONS',
    successes: [{ itemType: 'SESSIONS', cwd: '/external/metadata-only', source: '/external/source', target: 'not-an-owned-thread' }], failures: [] }] });
  const history = await call('externalAgentConfig/import/readHistories', {});
  assert.ok(history.data.some(row => row.providerId === 'owned-external-history' && row.successes[0]?.target === 'not-an-owned-thread'));
  const context = await c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: [] }); await c.runtime.dispatchMigration(context);
  const imported = await c.import(context.params), verified = await c.runtime.reviewMigration(context, imported.ack, imported.terminal);
  assert.deepEqual(verified.identity, before); assert.deepEqual(verified.effects, []); c.runtime.finishMigration(context);
  assert.equal((await c.call('externalAgentConfig/import/readHistories', null)).data.length, history.data.length);
});
Then('interrupted imports invalidate only dispatched uncertain file authority and cannot be replayed', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }), detected = await c.call('externalAgentConfig/detect', { includeHome: true });
  const input = { migrationItems: detected.items.filter(item => item.itemType === 'AGENTS_MD') }, before = await c.runtime.authority();
  const prepared = await c.runtime.prepareMigration('externalAgentConfig/import', input); c.runtime.abortMigration(prepared);
  assert.deepEqual(await c.runtime.authority(), before); await assert.rejects(() => c.runtime.dispatchMigration(prepared), /Unowned/);
  const dispatched = await c.runtime.prepareMigration('externalAgentConfig/import', input); await c.runtime.dispatchMigration(dispatched);
  const imported = await c.import(dispatched.params); c.runtime.abortMigration(dispatched);
  const revoked = await c.runtime.authority(); assert.notEqual(revoked.configuration, before.configuration);
  assert.deepEqual({ ...revoked, configuration: before.configuration }, before);
  await assert.rejects(() => c.runtime.reviewMigration(dispatched, imported.ack, imported.terminal), /Unowned/);
  c.runtime.abortMigration(dispatched); assert.deepEqual(await c.runtime.authority(), revoked);
});
Then('the owned agent protocol correlates SDK completion and sends its private receipt before the result', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }), detected = await c.call('externalAgentConfig/detect', { includeHome: true });
  const params = { migrationItems: detected.items.filter(item => ['CONFIG', 'AGENTS_MD'].includes(item.itemType)), providerId: 'owned-protocol' };
  const before = await c.runtime.authority(), identity = { ...before }, sent = [], requestId = 'owned_migration_protocol'; let queue = Promise.resolve(), protocolError;
  c.agent = createCodexAgentSession({ identity, authority: c.runtime.authority, send: frame => sent.push(structuredClone(frame)), write: frame => c.child.send(frame), threads: new Map(), allowAgent: false,
    allowMigration: true, prepareMigration: c.runtime.prepareMigration, dispatchMigration: c.runtime.dispatchMigration,
    reviewMigration: async (...args) => { assert.equal(sent.some(frame => frame.id === requestId), false, 'An SDK acknowledgement cannot precede effect/history verification'); return c.runtime.reviewMigration(...args); },
    migrationAuthority: c.runtime.migrationAuthority, finishMigration: c.runtime.finishMigration, abortMigration: c.runtime.abortMigration });
  c.onFrame = frame => { queue = queue.then(() => c.agent.receive(frame)).catch(error => { protocolError = error; }); };
  const forwarded = await c.agent.request({ id: requestId, method: 'externalAgentConfig/import', params }); c.child.send(forwarded);
  await waitForWatch(() => protocolError || sent.some(frame => frame.id === requestId), 'Owned migration protocol did not finish.'); await queue; if (protocolError) throw protocolError;
  const result = sent.find(frame => frame.id === requestId), authority = sent.find(frame => frame.type === 'authority'); assert.ok(result?.result); assert.ok(authority);
  const verified = nativeMigrationTransition(authority, before, requestId, await nativeConfigurationWriteHash(params), await nativeConfigurationWriteHash(result.result));
  assert.ok(verified.privateValues.includes(sourceSecret)); assert.equal(JSON.stringify(result).includes(sourceSecret), false);
  assert.ok(sent.indexOf(authority) < sent.indexOf(result)); assert.deepEqual(identity, await c.runtime.authority());
  assert.equal(sent.some(frame => [progress, completed].includes(frame.method)), false, 'Raw migration progress and completion remain private');
});
Then('memory and session imports with repository cwd retain global destinations and effect authority', { timeout: 60000 }, async function () {
  let sessionPath;
  const c = await sdkFixture(this, { isolated: true, beforeOpen: async c => {
    const project = join(c.sourceHome, '.claude/projects/owned-project'); await mkdir(join(project, 'memory'), { recursive: true });
    await writeFile(join(project, 'memory/MEMORY.md'), 'Owned scoped global memory.\n'); sessionPath = join(project, randomUUID() + '.jsonl');
    const records = ['user', 'assistant'].map(type => ({ type, cwd: c.workspace, timestamp: new Date().toISOString(), message: { content: 'Owned global session context.' } }));
    await writeFile(sessionPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    await writeFile(join(c.home, 'config.toml'), await readFile(join(c.home, 'config.toml'), 'utf8') + '[features]\nexternal_agent_memory_import=true\n');
  } });
  const input = { migrationItems: [{ ...item('MEMORY'), cwd: c.workspace, details: { memory: ['owned-project'] } },
    { ...item('SESSIONS'), cwd: c.workspace, details: { sessions: [{ cwd: c.workspace, path: sessionPath }] } }] };
  const context = await c.runtime.prepareMigration('externalAgentConfig/import', input); assert.ok(context.scopes.some(scope => scope.cwd === null));
  await c.runtime.dispatchMigration(context); const imported = await c.import(context.params), verified = await c.runtime.reviewMigration(context, imported.ack, imported.terminal);
  assert.ok(verified.effects.some(effect => effect.path.startsWith(join(c.home, 'memories')))); assert.ok(verified.effects.some(effect => effect.path.startsWith(join(c.home, 'sessions'))));
  assert.notEqual(verified.identity.configuration, context.before.identity.configuration); c.runtime.finishMigration(context);
  assert.equal(await readFile(join(c.home, 'memories/extensions/external_agent_import/resources/owned-project/MEMORY.md'), 'utf8'), 'Owned scoped global memory.\n');
});
Then('owned import verification reads its persisted row without fetching the accumulated history', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true });
  const seed = await c.call('externalAgentConfig/import/recordHistory', { providerId: 'owned-history-seed', itemTypeResults: [{ itemType: 'SESSIONS',
    successes: [{ itemType: 'SESSIONS', source: 'x'.repeat(512) }], failures: [] }] });
  const path = join(c.home, '.operations-migrations', nativeMigrationStateDatabase), database = new DatabaseSync(path, { timeout: 1000 });
  try {
    const copy = database.prepare('INSERT INTO external_agent_config_imports (import_id, provider_id, completed_at_ms, successes, failures) SELECT ?, provider_id, completed_at_ms, successes, failures FROM external_agent_config_imports WHERE import_id = ?');
    database.exec('BEGIN'); for (let index = 0; index < 256; index++) copy.run('owned_seed_' + index, seed.importId); database.exec('COMMIT');
    assert.ok(database.prepare('SELECT sum(length(successes)) AS bytes FROM external_agent_config_imports').get().bytes > nativeRuntimeLimits.frame);
  } finally { database.close(); }
  const detected = await c.call('externalAgentConfig/detect', { includeHome: true }), context = await c.runtime.prepareMigration('externalAgentConfig/import', { migrationItems: detected.items.filter(item => item.itemType === 'AGENTS_MD') });
  await c.runtime.dispatchMigration(context); const imported = await c.import(context.params), verified = await c.runtime.reviewMigration(context, imported.ack, imported.terminal);
  assert.ok(verified.effects.length); assert.ok((await nativeMigrationHistoryRow(join(c.home, '.operations-migrations'), imported.ack.importId)).sequence > context.sequence);
  c.runtime.finishMigration(context); assert.equal(await readFile(join(c.home, 'AGENTS.md'), 'utf8'), 'Owned global migration instructions.\n');
});
async function sdkFixture(world, options = {}) {
  const c = { directory: await mkdtemp(join(tmpdir(), 'native-migration-')), frames: [], sequence: 0, starts: 0, exits: 0 }; world.migrationFixtures.push(c);
  if (options.isolated) { c.privateRoot = join(c.directory, 'private'); await mkdir(c.privateRoot, { mode: 0o700 }); }
  c.home = options.isolated ? join(c.privateRoot, 'codex') : join(c.directory, 'home'); c.workspace = join(c.directory, 'workspace');
  await mkdir(c.home, { mode: 0o700 }); await mkdir(c.workspace); await mkdir(join(c.workspace, '.git'));
  c.sourceHome = c.privateRoot ?? c.home;
  await writeFile(join(c.home, 'config.toml'), 'sqlite_home=' + JSON.stringify(join(c.home, 'history')) + '\n', { mode: 0o600 });
  await mkdir(join(c.sourceHome, '.claude'));
  await writeFile(join(c.sourceHome, '.claude/CLAUDE.md'), 'Owned global migration instructions.\n');
  await writeFile(join(c.sourceHome, '.claude/settings.json'), JSON.stringify({ env: { OWNED_MIGRATION_SECRET: sourceSecret } }));
  await mkdir(join(c.sourceHome, '.cursor')); await writeFile(join(c.sourceHome, '.cursor/cli-config.json'), JSON.stringify({ env: { SOURCE: 'owned-secondary' } }));
  await mkdir(join(c.workspace, '.claude')); await writeFile(join(c.workspace, '.claude/CLAUDE.md'), 'Owned repository migration instructions.\n');
  await options.beforeOpen?.(c);
  c.runtime = await openCodexRuntime({ runtimeId: randomUUID(), home: c.home, workspace: c.workspace, allowMigration: options.isolated === true,
    ...(options.omitMigrationHome ? {} : { migrationHome: c.migrationHome ?? c.privateRoot }), allowConfigurationWrite: options.allowConfigurationWrite === true, allowCommands: options.allowCommands === true,
    executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
  c.call = async (method, params) => {
    const id = 'owned_migration_' + ++c.sequence; c.child.send({ id, method, params });
    await waitForWatch(() => c.frames.some(f => f.id === id), 'Owned SDK migration response timed out.');
    const frame = c.frames.find(f => f.id === id); assert.ok(frame.result, 'SDK migration response unavailable: ' + (frame.error?.code ?? 'missing result')); return frame.result;
  };
  c.start = async () => {
    c.starts++; c.child = await c.runtime.start(frame => { c.frames.push(structuredClone(frame)); c.onFrame?.(frame); }, () => { c.exits++; });
    await c.call('initialize', nativeInitializeParams()); c.child.send({ method: 'initialized' });
  };
  c.import = async input => {
    const start = c.frames.length, normalized = params('externalAgentConfig/import', input), correlation = new NativeMigrationCorrelation(normalized);
    const ack = await c.call('externalAgentConfig/import', normalized); let terminal = correlation.acknowledge(ack);
    if (!terminal) {
      await waitForWatch(() => c.frames.slice(start).some(f => f.method === completed && f.params.importId === ack.importId), 'Owned import completion was not emitted.');
      for (const frame of c.frames.slice(start)) if ([progress, completed].includes(frame.method)) terminal = correlation.notification(frame.method, frame.params) ?? terminal;
    }
    return { ack, terminal, frames: c.frames.slice(start) };
  };
  await c.start(); return c;
}

Then('migration contracts preserve sources attribution details and all native item kinds', () => {
  assert.equal(nativeMigrationMethods.length, 4); assert.deepEqual([...nativeMigrationItemTypes], kinds);
  for (const method of nativeMigrationMethods) assert.equal(nativeMigrationInputSchema(method).additionalProperties, false);
  assert.deepEqual(params('externalAgentConfig/detect', {}), { includeHome: false });
  const detect = { includeHome: true, migrationSource: 'unknown-native-fallback', source: 'cursor', cwds: ['workspace'], maxSessions: 0, maxSessionAgeDays: null };
  assert.deepEqual(params('externalAgentConfig/detect', detect), detect);
  const input = { ...request(...kinds), migrationSource: 'cursor', source: 'owned-initiator', providerId: 'opaque-provider' };
  const details = { commands: [{ name: 'owned-command' }], hooks: [{ name: 'owned-hook' }], mcpServers: [{ name: 'owned-mcp' }],
    skills: [{ name: 'owned-skill' }], subagents: [{ name: 'owned-agent' }], memory: ['project-memory.md'],
    plugins: [{ marketplaceName: 'owned-market', pluginNames: ['owned-plugin'] }], sessions: [{ cwd: '.', path: 'session.jsonl', title: 'Owned\nsession title' }] };
  input.migrationItems[0].details = details;
  const normalized = params('externalAgentConfig/import', input); assert.deepEqual(normalized, input);
  input.migrationItems[0].details.skills[0].name = 'changed'; assert.equal(normalized.migrationItems[0].details.skills[0].name, 'owned-skill');
  assert.deepEqual(params('externalAgentConfig/import/readHistories', {}), {});
  const record = { providerId: '', itemTypeResults: [{ itemType: 'SESSIONS', successes: [{ itemType: 'SESSIONS', cwd: '', source: null, target: 'external-thread', title: null }], failures: [] }] };
  assert.deepEqual(params('externalAgentConfig/import/recordHistory', record), record);
});
Then('migration contracts reject malformed fields bounds accessors and inconsistent results', () => {
  const bad = (method, input, field, path) => assert.throws(() => params(method, input), e => e.field === field && (!path || e.message.includes(path)));
  bad('externalAgentConfig/import', {}, 'migrationItems');
  bad('externalAgentConfig/detect', { includeHome: 'true' }, 'includeHome');
  bad('externalAgentConfig/detect', { maxSessions: 129 }, 'maxSessions');
  bad('externalAgentConfig/detect', { maxSessionAgeDays: -1 }, 'maxSessionAgeDays');
  bad('externalAgentConfig/detect', { cwds: [''] }, 'cwds', 'cwds[0]');
  bad('externalAgentConfig/import/readHistories', { providerId: 'unowned-filter' }, 'providerId');
  bad('externalAgentConfig/import', { migrationItems: new Array(1) }, 'migrationItems');
  const accessor = {}; let invoked = false; Object.defineProperty(accessor, 'includeHome', { enumerable: true, get() { invoked = true; return true; } });
  bad('externalAgentConfig/detect', accessor, 'params'); assert.equal(invoked, false);
  bad('externalAgentConfig/import', { migrationItems: [{ ...item('SESSIONS'), details: { sessions: [{ cwd: '.', path: false }] } }] }, 'migrationItems', 'migrationItems[0].details.sessions[0].path');
  bad('externalAgentConfig/import', request('UNKNOWN'), 'migrationItems', 'migrationItems[0].itemType');
  bad('externalAgentConfig/import', { migrationItems: [{ ...item('MEMORY'), details: { memory: [] } }] }, 'migrationItems', 'details.memory');
  bad('externalAgentConfig/import', { migrationItems: [{ ...item('CONFIG'), details: { credentials: 'not-a-detail' } }] }, 'migrationItems', 'details.credentials');
  bad('externalAgentConfig/import/recordHistory', { providerId: 'owned', itemTypeResults: [{ itemType: 'CONFIG', successes: [{ itemType: 'SKILLS' }], failures: [] }] }, 'itemTypeResults', 'successes[0].itemType');
  bad('externalAgentConfig/import', { migrationItems: kinds.map(kind => ({ ...item(kind), description: '😀'.repeat(1024) })), source: 's'.repeat(193) }, 'source');
  bad('externalAgentConfig/import', { migrationItems: Array.from({ length: 16 }, () => ({ ...item('CONFIG'), description: '😀'.repeat(1024) })) }, 'params');
});
Then('migration acknowledgements progress completion and empty imports retain native ordering', () => {
  const owned = new NativeMigrationCorrelation(request('CONFIG', 'SKILLS'));
  assert.equal(owned.acknowledge({ importId: 'owned-import' }), undefined);
  assert.equal(owned.notification(progress, result('owned-import', 'CONFIG')), undefined);
  const terminal = result('owned-import', 'CONFIG', 'SKILLS'); terminal.itemTypeResults[0].failures.push({ itemType: 'CONFIG', failureStage: 'import_request_failed', message: 'Owned failure', errorType: 'invalid_existing_config', subErrorType: null });
  assert.deepEqual(owned.notification(completed, terminal), terminal);
  const early = new NativeMigrationCorrelation(request('CONFIG')), value = result('early-import', 'CONFIG');
  assert.equal(early.notification(progress, value), undefined); assert.equal(early.notification(completed, value), undefined);
  value.itemTypeResults[0].successes.push({ itemType: 'CONFIG', target: 'later-unowned-mutation' });
  assert.deepEqual(early.acknowledge({ importId: 'early-import' }), result('early-import', 'CONFIG'));
  assert.deepEqual(new NativeMigrationCorrelation(request()).acknowledge({ importId: 'empty-import' }), { importId: 'empty-import', itemTypeResults: [] });
});
Then('migration correlation rejects unknown incomplete duplicate cancelled and excessive events', () => {
  for (const mode of ['foreign', 'unknown', 'incomplete', 'duplicate-kind', 'inner-kind', 'extra', 'duplicate-ack', 'replay', 'close']) {
    const c = new NativeMigrationCorrelation(request('CONFIG', 'SKILLS')); c.acknowledge({ importId: 'owned' });
    const value = result(mode === 'foreign' ? 'foreign' : 'owned', 'CONFIG', 'SKILLS');
    if (mode === 'unknown') value.itemTypeResults[0].itemType = 'PLUGINS';
    if (mode === 'incomplete') value.itemTypeResults.pop();
    if (mode === 'duplicate-kind') value.itemTypeResults[1].itemType = 'CONFIG';
    if (mode === 'inner-kind') value.itemTypeResults[0].successes.push({ itemType: 'SKILLS' });
    if (mode === 'extra') value.secret = 'unclassified';
    if (mode === 'close') c.close();
    if (mode === 'duplicate-ack') assert.throws(() => c.acknowledge({ importId: 'owned' }));
    else { if (mode === 'replay') c.notification(completed, value); assert.throws(() => c.notification(completed, value)); }
    assert.throws(() => c.acknowledge({ importId: 'retry' }));
  }
  const early = new NativeMigrationCorrelation(request('CONFIG')); early.notification(completed, result('unowned', 'CONFIG'));
  assert.throws(() => early.acknowledge({ importId: 'owned' }));
  const full = new NativeMigrationCorrelation(request('CONFIG'));
  for (let i = 0; i < 32; i++) full.notification(progress, result('owned', 'CONFIG'));
  assert.throws(() => full.notification(progress, result('owned', 'CONFIG')));
  assert.throws(() => new NativeMigrationCorrelation(request()).notification(completed, result('unowned')));
});
Then('the pinned SDK separates migration selectors acknowledgement completion and persistent history', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this), before = await c.runtime.authority();
  const defaults = await c.call('externalAgentConfig/detect', { includeHome: true });
  assert.deepEqual(await c.call('externalAgentConfig/detect', { includeHome: true, migrationSource: 'unknown-fallback', source: 'cursor' }), defaults);
  assert.ok(defaults.items.some(i => i.itemType === 'AGENTS_MD')); assert.ok(defaults.items.some(i => i.itemType === 'CONFIG'));
  const selected = defaults.items.filter(i => ['AGENTS_MD', 'CONFIG'].includes(i.itemType));
  const imported = await c.import({ migrationItems: selected, migrationSource: 'claude-code', providerId: 'opaque-owned-provider', source: 'owned-prototype' });
  assert.equal(imported.terminal.importId, imported.ack.importId);
  assert.ok(imported.terminal.itemTypeResults.every(r => r.successes.length === 1 && r.failures.length === 0));
  assert.ok(imported.frames.findIndex(f => f.result?.importId === imported.ack.importId) < imported.frames.findIndex(f => f.method === completed));
  assert.ok((await readFile(join(c.home, 'config.toml'), 'utf8')).includes(sourceSecret));
  assert.equal(await readFile(join(c.home, 'AGENTS.md'), 'utf8'), 'Owned global migration instructions.\n');
  const after = await c.runtime.authority(); assert.notEqual(after.configuration, before.configuration); assert.deepEqual({ ...after, configuration: before.configuration }, before);
  const history = await c.call('externalAgentConfig/import/readHistories', null), row = history.data.find(i => i.importId === imported.ack.importId);
  assert.ok(row); assert.equal(row.providerId, 'opaque-owned-provider'); assert.equal(row.successes.length, 2); assert.deepEqual(row.failures, []);
  const secondary = await c.call('externalAgentConfig/detect', { includeHome: true, migrationSource: 'cursor' });
  assert.ok(secondary.items.some(i => i.itemType === 'CONFIG'));
  const next = await c.import({ migrationItems: secondary.items.filter(i => i.itemType === 'CONFIG'), migrationSource: 'cursor', providerId: 'claude-code' });
  assert.ok(next.terminal.itemTypeResults.every(r => r.failures.length === 0));
  assert.ok((await readFile(join(c.home, 'config.toml'), 'utf8')).includes('owned-secondary'));
  const unchanged = await readFile(join(c.home, 'config.toml')), empty = await c.import({ migrationItems: [] });
  assert.deepEqual(empty.terminal, { importId: empty.ack.importId, itemTypeResults: [] });
  await c.call('account/read', { refreshToken: false });
  assert.ok(!c.frames.some(f => f.method === completed && f.params.importId === empty.ack.importId));
  assert.deepEqual(await readFile(join(c.home, 'config.toml')), unchanged);
  await c.child.close(); await c.start();
  assert.ok((await c.call('externalAgentConfig/import/readHistories', null)).data.some(i => i.importId === imported.ack.importId));
  assert.equal(JSON.stringify(c.frames).includes(sourceSecret), false);
});
Then('the pinned SDK records external history and retains repository redirection semantics', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this), before = await readFile(join(c.home, 'config.toml'));
  const record = params('externalAgentConfig/import/recordHistory', { providerId: 'owned-external-completion', itemTypeResults: [
    { itemType: 'SESSIONS', successes: [{ itemType: 'SESSIONS', cwd: c.workspace, source: join(c.workspace, 'external-session.jsonl'), target: 'external-thread', title: 'Owned external session' }], failures: [] },
    { itemType: 'CONFIG', successes: [], failures: [{ itemType: 'CONFIG', failureStage: 'owned-external-stage', message: 'Owned external failure', errorType: 'owned', subErrorType: null, cwd: null, source: null }] }
  ] });
  const ack = await c.call('externalAgentConfig/import/recordHistory', record); assert.ok(ack.importId);
  const saved = (await c.call('externalAgentConfig/import/readHistories', null)).data.find(h => h.importId === ack.importId);
  assert.equal(saved.providerId, record.providerId); assert.ok(saved.completedAtMs > 0);
  assert.equal(saved.successes[0].target, 'external-thread'); assert.equal(saved.failures[0].failureStage, 'owned-external-stage');
  assert.deepEqual(await readFile(join(c.home, 'config.toml')), before);
  await mkdir(join(c.workspace, 'nested')); const found = await c.call('externalAgentConfig/detect', { includeHome: false, cwds: [join(c.workspace, 'nested')] });
  const instructions = found.items.find(i => i.itemType === 'AGENTS_MD'); assert.ok(instructions); assert.equal(instructions.cwd, c.workspace);
  const escaped = join(c.directory, 'escaped'); await mkdir(escaped); await symlink(escaped, join(c.workspace, '.codex'));
  const skipped = await c.import({ migrationItems: [instructions] });
  assert.deepEqual(skipped.terminal.itemTypeResults[0].successes, []);
  await assert.rejects(readFile(join(c.workspace, 'AGENTS.md')), e => e.code === 'ENOENT');
  await assert.rejects(readFile(join(escaped, 'AGENTS.md')), e => e.code === 'ENOENT');
  assert.equal(JSON.stringify(c.frames).includes(sourceSecret), false);
});
Then('the pinned SDK home skill imports use the Codex parent and history uses its configured database', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this), before = await c.runtime.authority();
  for (const name of ['owned-first-skill', 'owned-second-skill']) {
    const path = join(c.home, '.claude/skills', name); await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), '---\nname: ' + name + '\ndescription: Owned migration scope fixture.\n---\nOwned migration instructions.\n');
  }
  const detected = await c.call('externalAgentConfig/detect', { includeHome: true }), selected = detected.items.find(i => i.itemType === 'SKILLS');
  assert.equal(selected.details.skills.length, 2);
  selected.details.skills = selected.details.skills.slice(0, 1);
  const imported = await c.import({ migrationItems: [selected], providerId: 'owned-skill-scope' });
  const typed = imported.terminal.itemTypeResults.find(i => i.itemType === 'SKILLS'); assert.equal(typed.successes.length, 2); assert.deepEqual(typed.failures, []);
  // The native importer migrates the whole skill scope and chooses the parent
  // of CODEX_HOME, even when the request's details list names only one skill.
  for (const name of ['owned-first-skill', 'owned-second-skill']) {
    assert.ok((await readFile(join(c.directory, '.agents/skills', name, 'SKILL.md'), 'utf8')).includes('Owned migration instructions.'));
    await assert.rejects(readFile(join(c.home, '.agents/skills', name, 'SKILL.md')), e => e.code === 'ENOENT');
  }
  assert.deepEqual(await c.runtime.authority(), before, 'Existing authority hashes do not cover these skill files; migration needs its own effect verification.');
  const directory = join(c.home, 'history'), names = await readdir(directory);
  const databaseFiles = names.filter(n => n.endsWith('.sqlite') || n.endsWith('.sqlite-wal')); assert.ok(databaseFiles.length);
  const blocks = await Promise.all(databaseFiles.map(name => readFile(join(directory, name))));
  assert.ok(blocks.some(bytes => bytes.includes(Buffer.from(imported.ack.importId))), 'The migration history must be in the explicitly configured private database.');
  assert.ok((await c.call('externalAgentConfig/import/readHistories', null)).data.some(row => row.importId === imported.ack.importId));
});
Then('the migration runtime protects the complete source target home and isolates native history', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true }), directory = join(c.sourceHome, '.claude/skills/owned-isolated-skill'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), '---\nname: owned-isolated-skill\ndescription: Owned isolated fixture.\n---\nOwned isolated instructions.\n');
  const raw = await c.runtime.inspectConfiguration();
  assert.ok(raw.layers.some(layer => layer.config.permissions?.operations?.filesystem?.[c.privateRoot] === 'deny'));
  const history = join(c.home, '.operations-migrations'); assert.ok(raw.layers.some(layer => layer.config.sqlite_home === history));
  assert.throws(() => c.runtime.prepareConfigurationWrite('config/value/write', { keyPath: 'model', value: 'ungranted', mergeStrategy: 'replace' }), /not granted/);
  const detected = await c.call('externalAgentConfig/detect', { includeHome: true }), selected = detected.items.find(i => i.itemType === 'SKILLS'); assert.ok(selected);
  const imported = await c.import({ migrationItems: [selected] }); assert.equal(imported.terminal.itemTypeResults[0].successes.length, 1);
  assert.ok((await readFile(join(c.privateRoot, '.agents/skills/owned-isolated-skill/SKILL.md'), 'utf8')).includes('Owned isolated instructions.'));
  assert.ok((await c.call('externalAgentConfig/import/readHistories', null)).data.some(row => row.importId === imported.ack.importId));
  await assert.rejects(readdir(join(c.home, 'history')), e => e.code === 'ENOENT');
  assert.ok((await readdir(history)).some(name => name.endsWith('.sqlite')));
  await chmod(c.privateRoot, 0o755); await assert.rejects(c.runtime.authority(), /Migration root authority/);
});
Then('migration root isolation keeps separately granted configuration writes compatible', { timeout: 60000 }, async function () {
  const c = await sdkFixture(this, { isolated: true, allowConfigurationWrite: true }), before = await c.runtime.authority();
  const context = await c.runtime.prepareConfigurationWrite('config/value/write', { keyPath: 'model', value: 'owned-isolated-model', mergeStrategy: 'replace' });
  const result = await c.call('config/value/write', context.params), verified = await c.runtime.reviewConfigurationWrite(context, result);
  assert.equal(verified.identity.runtimeId, before.runtimeId); assert.notEqual(verified.identity.configuration, before.configuration);
  assert.deepEqual({ ...verified.identity, configuration: before.configuration }, before);
});
Then('migration startup rejects missing shared redirected or workspace overlapping private roots', { timeout: 60000 }, async function () {
  for (const mode of ['missing', 'shared', 'alias', 'history-link', 'database-link', 'workspace']) {
    await assert.rejects(sdkFixture(this, { isolated: true, omitMigrationHome: mode === 'missing', beforeOpen: async c => {
      if (mode === 'shared') await chmod(c.privateRoot, 0o755);
      if (mode === 'alias') { c.migrationHome = join(c.directory, 'alias'); await symlink(c.privateRoot, c.migrationHome); }
      if (mode === 'history-link') { const outside = join(c.directory, 'outside-history'); await mkdir(outside); await symlink(outside, join(c.home, '.operations-migrations')); }
      if (mode === 'database-link') {
        const outside = join(c.directory, 'outside.sqlite'); await writeFile(outside, 'owned external database');
        await mkdir(join(c.home, '.operations-migrations'), { mode: 0o700 }); await symlink(outside, join(c.home, '.operations-migrations/state_5.sqlite'));
      }
      if (mode === 'workspace') { c.workspace = join(c.privateRoot, 'workspace'); await mkdir(c.workspace); }
    } }), /[Mm]igration/);
  }
});
