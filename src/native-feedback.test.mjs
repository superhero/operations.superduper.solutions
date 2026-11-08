// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { link, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeFeedbackFixture } from '../tests/native-feedback.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { prepareNativeFeedback } from '../companions/codex/feedback.mjs';
import { nativeFeedbackParams, nativeFeedbackLimits, publicNativeFeedbackResult } from './lib/native-feedback-contract.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createAtprotoHttpConnection, createJiraHttpConnection } from './lib/secrets/http-connections.ts';
import { atprotoScope } from './lib/secrets/atproto-config.ts';
import { validateAtprotoState } from './lib/secrets/atproto-state.ts';
import { validateJiraState } from './lib/secrets/jira-companion.ts';

Before({ tags: '@native-feedback' }, function () { this.feedback = []; });
After({ tags: '@native-feedback' }, async function () { for (const { v, f } of this.feedback.reverse()) { v.session.lock(); await f.close(); } });
const wait = async predicate => { const end = Date.now() + 3500; while (!predicate()) { assert.ok(Date.now() < end, 'Feedback ownership transition timed out.'); await new Promise(resolve => setTimeout(resolve, 5)); } };
async function setup(world, options = {}) {
  const f = await nativeFeedbackFixture(options), v = await nativeVaultFixture(f); world.feedback.push({ f, v });
  const source = await readServiceSchema('codex'), document = scopeNativeRpcSchema(source, 'feedback/upload'), selection = { document, operation: nativeRpcOperation(document, 'codex:feedback/upload') };
  const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const execute = (input = { classification: 'bug' }, signal, ref = nativeReference(paired)) => v.session.executeNativeFeedback(ref, v.selection, selection, input, signal);
  return { f, v, paired, selection, execute };
}

Then('feedback uploads preserve their complete bounded inputs and native result ports', async function () {
  const { f, v, selection, execute } = await setup(this);
  const params = { classification: 'bug', reason: 'Synthetic feedback\nSecond line.', tags: { component: 'fixture' }, threadId: null, extraLogFiles: null };
  const result = await execute(params);
  assert.deepEqual(result.request, { protocol: 'json-rpc', method: 'feedback/upload', params: nativeFeedbackParams(params) });
  assert.deepEqual(result.response.result, { threadId: 'no-active-thread-fixture', promptHash: null });
  assert.deepEqual(f.frames.find(frame => frame.method === 'feedback/upload').params, nativeFeedbackParams(params));
  await wait(() => f.starts === f.stops); const starts = f.starts; await execute(); await wait(() => f.starts === f.stops);
  assert.equal(f.starts, starts + 1, 'Every explicit upload uses a new owned child.'); assert.equal(f.feedbackCalls, 2);
  const { operation, document } = selection;
  assert.deepEqual(prepareNativeRequest(operation, { 'params:classification': 'bug', 'params:tags': '{"component":"fixture"}', 'params:includeLogs': 'false' }).params,
    { classification: 'bug', tags: { component: 'fixture' }, includeLogs: false });
  assert.deepEqual(operation.capabilities.requirements.map(item => item.code), ['native-host', 'native-method']);
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'feedback', document), saved = { version: 3, id: 'feedback', name: 'Feedback', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved); assert.deepEqual(portableWorkflowDocument(saved), saved);
  const fields = graph.nodes.filter(node => node.type === 'data' && node.data.direction === 'outputs').flatMap(node => node.data.fields);
  for (const path of ['/result/threadId', '/result/promptHash']) assert.ok(fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === path && field.type === 'Text' && field.connectable));
  assert.deepEqual(scopeNativeRpcSchema(document, 'feedback/upload'), document);
  assert.equal(JSON.stringify(v.storage.state).includes(f.key), false);
});

Then('feedback and diagnostic tickets require their separate host permissions', async function () {
  const disabled = await setup(this, { allowFeedback: false, allowMetadata: true, allowApps: true, allowAgent: true });
  const starts = disabled.f.starts;
  await assert.rejects(disabled.execute(), error => error.code === 'NATIVE_FEEDBACK'); assert.equal(disabled.f.starts, starts);
  const { f, v, paired, selection, execute } = await setup(this);
  for (const params of [{ classification: 'bug', includeLogs: true }, { classification: 'bug', extraLogFiles: ['report.log'] }, { classification: 'bug', threadId: 'foreign' }])
    await assert.rejects(execute(params), error => error.code === 'NATIVE_FEEDBACK');
  assert.equal(f.feedbackCalls ?? 0, 0);
  await assert.rejects(v.session.executeNativeQuery(nativeReference(paired), v.selection, selection, { classification: 'bug' }), error => error.code === 'PERMISSION');
  for (const input of [{}, { classification: '' }, { classification: 'bug', includeLogs: null }, { classification: 'bug', tags: { a: 1 } },
    { classification: 'bug', extraLogFiles: Array(9).fill('x') }, { classification: 'bug', apiKey: 'unapproved' }]) assert.throws(() => nativeFeedbackParams(input));
});

Then('feedback uploads freeze complete workspace files and clean their private snapshots', async function () {
  const { f, execute } = await setup(this, { allowFeedbackDiagnostics: true });
  const path = join(f.workspace, 'report.log'), bytes = Buffer.from([0, 255, 1, 13, 10, 42]); await writeFile(path, bytes);
  const lease = await prepareNativeFeedback({ classification: 'bug', extraLogFiles: ['report.log'] }, { workspace: f.workspace, home: f.home, allowDiagnostics: true, pairingKey: f.key });
  await writeFile(path, 'changed after snapshot'); assert.deepEqual(await readFile(lease.params.extraLogFiles[0]), bytes);
  assert.equal((await stat(lease.params.extraLogFiles[0])).mode & 0o777, 0o600); await lease.close();
  await assert.rejects(readFile(lease.params.extraLogFiles[0]));
  await writeFile(path, bytes); await execute({ classification: 'bug', includeLogs: true, extraLogFiles: ['report.log', 'report.log'] });
  assert.deepEqual(f.attachmentBytes, [bytes]); assert.notEqual(f.frozenPaths[0], path); assert.equal(basename(f.frozenPaths[0]), 'report.log');
  await wait(() => f.starts === f.stops); await assert.rejects(readFile(f.frozenPaths[0]));
  assert.deepEqual(await readdir(join(f.home, 'operations-feedback')), []);
});

Then('feedback attachment preparation rejects unauthorized paths and bounded file violations', async function () {
  const { f } = await setup(this, { allowFeedbackDiagnostics: true });
  const options = { workspace: f.workspace, home: f.home, allowDiagnostics: true, pairingKey: f.key };
  await writeFile(join(f.home, 'private.log'), 'private'); await symlink(f.home, join(f.workspace, 'escape'));
  await link(join(f.home, 'private.log'), join(f.workspace, 'hard-link.log')); await mkdir(join(f.workspace, 'directory'));
  execFileSync('mkfifo', [join(f.workspace, 'pipe.log')], { timeout: 1000 });
  await writeFile(join(f.workspace, 'too-large.log'), Buffer.alloc(nativeFeedbackLimits.fileBytes + 1));
  await writeFile(join(f.workspace, 'credential.log'), f.key);
  for (const path of ['..', f.home + '/private.log', 'escape/private.log', 'hard-link.log', 'directory', 'pipe.log', 'too-large.log', 'credential.log'])
    await assert.rejects(prepareNativeFeedback({ classification: 'bug', extraLogFiles: [path] }, options));
  const files = [];
  for (let i = 0; i < 5; i++) { const name = 'part-' + i + '.log'; files.push(name); await writeFile(join(f.workspace, name), Buffer.alloc(nativeFeedbackLimits.fileBytes)); }
  await assert.rejects(prepareNativeFeedback({ classification: 'bug', extraLogFiles: files }, options));
  assert.deepEqual(await readdir(join(f.home, 'operations-feedback')), []);
});

Then('feedback result validation withholds private values and unclassified acknowledgements', async function () {
  const { f, v, execute } = await setup(this), secret = 'SYNTHETIC_FEEDBACK_SECRET'; await v.session.put(null, { label: 'Feedback echo fixture', kind: 'secret', value: secret });
  const before = f.frames.length; await assert.rejects(execute({ classification: 'bug', reason: secret }), error => error.code === 'REDACTED'); assert.equal(f.frames.length, before);
  f.feedbackResult = { threadId: secret, promptHash: null }; await assert.rejects(execute(), error => error.code === 'REDACTED');
  for (const result of [{ threadId: 'owned', accessToken: 'unknown' }, { threadId: 1 }, { threadId: 'owned', promptHash: 'bad' }]) {
    f.feedbackResult = result; await assert.rejects(execute(), error => error.code === 'NATIVE_CONTRACT');
  }
  for (const result of [{ threadId: 'owned' }, { threadId: 'owned', promptHash: null }, { threadId: 'owned', promptHash: 'a'.repeat(64) }]) assert.deepEqual(publicNativeFeedbackResult(result), result);
});

Then('cancelled stale and uncertain feedback closes its owned child without retrying', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'timeout', 'sdk-error', 'stale']) {
    const { f, v, paired, execute } = await setup(this), controller = new AbortController();
    if (mode === 'stale') { await assert.rejects(execute(undefined, undefined, { ...nativeReference(paired), revision: 2 }), error => error.code === 'CONFLICT'); continue; }
    if (mode === 'sdk-error') { f.failFeedback = true; await assert.rejects(execute(), error => error.code === 'NATIVE_FEEDBACK'); }
    else {
      f.holdFeedback = true; const result = execute({ classification: 'bug' }, controller.signal); await wait(() => f.release.length === 1);
      if (mode === 'cancel') controller.abort(); else if (mode === 'source') { v.enabled = false; f.release.shift()(); }
      else if (mode === 'identity') { f.identity.workspace = 'd'.repeat(64); f.release.shift()(); }
      await assert.rejects(result, error => ['CANCELLED', 'PERMISSION', 'NATIVE_FEEDBACK'].includes(error.code));
    }
    await wait(() => f.starts === f.stops); assert.equal(f.feedbackCalls, 1); assert.equal(f.deliveries, 1, 'Cancelling a waiter does not roll back an accepted upload.');
  }
});

Then('native feedback withholds encrypted managed OAuth credentials before and after delivery', async function () {
  const { f, v, paired, execute } = await setup(this, { allowAgent: true }), id = crypto.randomUUID();
  const oauth = { profile: 'atproto-public-dpop-v1', clientId: 'https://operations.example.com/oauth/bluesky-client-metadata.json',
    redirectUri: 'https://operations.example.com/?operations_oauth_callback=bluesky', pds: 'https://pds.example.com/', issuer: 'https://auth.example.com/',
    scope: atprotoScope, accountId: 'did:plc:' + 'a'.repeat(24) };
  const state = { oauth, refreshPending: false, jwk: { kty: 'EC', crv: 'P-256', alg: 'ES256', x: 'x'.repeat(43), y: 'y'.repeat(43), d: 'd'.repeat(43) },
    tokenSet: { access_token: 'SYNTHETIC_NATIVE_DPOP_ACCESS', refresh_token: 'SYNTHETIC_NATIVE_DPOP_REFRESH', token_type: 'DPoP', sub: oauth.accountId,
      iss: oauth.issuer, aud: oauth.pds, scope: atprotoScope, expires_at: '2030-01-01T00:00:00.000Z' } };
  const raw = JSON.stringify(state); validateAtprotoState(raw);
  const document = await readServiceSchema('bluesky-app'), operation = inspectServiceSchema(document, 'bluesky-app', new Set(['bluesky-app:app.bsky.actor.getPreferences'])).operations[0];
  const connection = await createAtprotoHttpConnection(await approvedOperation(operation, 'https://pds.example.com'), id, 'Native OAuth privacy fixture', oauth);
  await v.session.save([...await v.session.records(), { id, label: 'Native OAuth privacy reference', kind: 'secret', value: crypto.randomUUID(), grants: [], connections: [connection], oauthState: raw }]);
  const jiraId = crypto.randomUUID(), jiraOauth = { profile: 'atlassian-jira-3lo-v1', scope: 'read:jira-user offline_access', host: 'https://jira-companion.example.com', siteUrl: 'https://fixture.atlassian.net',
    clientId: 'fixture_client', redirectUri: 'https://jira-companion.example.com/oauth/jira/callback', accountId: 'fixture-account', hostId: crypto.randomUUID(), cloudId: crypto.randomUUID(), configuration: 'a'.repeat(64) };
  const jiraOperation = { id: 'jira:getCurrentUser', name: 'User', description: '', group: 'User', method: 'GET', path: '/rest/api/3/myself', fields: [], bodyRequired: false,
    security: [[{ kind: 'bearer', name: 'OAuth2', header: 'Authorization' }]], oauthScopes: [{ OAuth2: ['read:jira-user'] }] };
  const jiraConnection = await createJiraHttpConnection(await approvedOperation(jiraOperation, jiraOauth.siteUrl), jiraId, 'Native Jira privacy fixture', jiraOauth);
  const jiraState = { profile: jiraOauth.profile, oauth: jiraOauth, origin: 'https://operations.example.com', accessKeyId: crypto.randomUUID(), accessKeyHash: 'b'.repeat(64), connectionId: crypto.randomUUID(), capability: 'C'.repeat(43) };
  const jiraRaw = JSON.stringify(jiraState); validateJiraState(jiraRaw);
  await v.session.save([...await v.session.records(), { id: jiraId, label: 'Native Jira privacy reference', kind: 'secret', value: crypto.randomUUID(), grants: [], connections: [jiraConnection], oauthState: jiraRaw }]);
  for (const secret of [state.tokenSet.access_token, state.tokenSet.refresh_token, state.jwk.d, jiraState.capability]) {
    const before = f.feedbackCalls ?? 0;
    await assert.rejects(execute({ classification: 'bug', reason: secret }), error => error.code === 'REDACTED'); assert.equal(f.feedbackCalls ?? 0, before);
    f.feedbackResult = { threadId: secret, promptHash: null }; await assert.rejects(execute(), error => error.code === 'REDACTED');
    assert.equal(JSON.stringify(v.storage.state).includes(secret), false);
  }
  const encodedKey = 'SYNTHETIC_NATIVE_FEEDBACK_KEY/+'; await v.session.put(null, { label: 'Encoded feedback key', kind: 'secret', value: encodedKey });
  const before = f.feedbackCalls;
  for (const secret of [encodeURIComponent(encodedKey), new URLSearchParams({ v: encodedKey }).toString().slice(2)])
    await assert.rejects(execute({ classification: 'bug', reason: secret }), error => error.code === 'REDACTED');
  assert.equal(f.feedbackCalls, before);
  const selections = await v.workflowSelections(), enabled = await v.session.enableNativeWorkflow(nativeReference(paired), selections);
  const keys = await v.session.put(null, { label: 'Managed native input provider', kind: 'apiKey', value: 'SYNTHETIC_NATIVE_INPUT_PROVIDER_KEY' });
  const connected = await v.session.loginNativeRuntime(nativeReference(enabled), selections, { type: 'apiKey', credentialId: keys.find(x => x.label === 'Managed native input provider').id });
  const frames = f.frames.length, start = selections.find(x => x.operation.rpc.method === 'thread/start');
  for (const secret of [state.tokenSet.access_token, state.tokenSet.refresh_token, state.jwk.d, jiraState.capability])
    await assert.rejects(v.session.executeNativeRuntime(nativeReference(connected), selections, start, { model: secret }), error => error.code === 'REDACTED');
  assert.equal(f.frames.length, frames, 'Managed credentials never reach an agent input either.');
});

Then('feedback accepts owned threads and rejects foreign or changed thread authority', async function () {
  const { f, v, paired, selection } = await setup(this, { allowAgent: true });
  const selections = await v.workflowSelections(), enabled = await v.session.enableNativeWorkflow(nativeReference(paired), selections);
  const keys = await v.session.put(null, { label: 'Feedback provider fixture', kind: 'apiKey', value: 'SYNTHETIC_PROVIDER_FEEDBACK_KEY' });
  const connected = await v.session.loginNativeRuntime(nativeReference(enabled), selections, { type: 'apiKey', credentialId: keys.find(x => x.label === 'Feedback provider fixture').id });
  const thread = await v.session.executeNativeRuntime(nativeReference(connected), selections, selections.find(x => x.operation.rpc.method === 'thread/start'), {});
  const execute = threadId => v.session.executeNativeFeedback(nativeReference(connected), v.selection, selection, { classification: 'bug', threadId });
  assert.equal((await execute(thread.response.result.thread.id)).response.result.threadId, thread.response.result.thread.id);
  await assert.rejects(execute('foreign-thread'), error => error.code === 'NATIVE_FEEDBACK');
  const calls = f.feedbackCalls; f.identity.accountEpoch = '10000000-0000-0000-0000-000000000001';
  await assert.rejects(execute(thread.response.result.thread.id), error => error.code === 'NATIVE_FEEDBACK'); assert.equal(f.feedbackCalls, calls);
});
