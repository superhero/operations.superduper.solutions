// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { applySchemaPatches, dockerHttpContracts } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { operations,operationSourceIdentity,publishPreparedCatalogs } from './lib/catalog.ts';
import { dockerNativeReadOperation } from './lib/docker-native-model.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { operationInsertionBlockReason } from './lib/operation-capabilities.ts';
import { bindDockerHttp, dockerHttpEndpoint, dockerHttpSourceSha256, dockerProgressIds, dockerHttpOperation, hasDockerNestedPrivateInput, validateDockerHttpServer, dockerHttpProfile } from './lib/docker-http.ts';
import { dockerReadOperations, dockerNativeOperationId, dockerNativeAttachOperationId, dockerAttachParams, dockerReadOperationIds, dockerOperationParams, dockerAttachReadPath } from './lib/docker-native-contract.ts';
import { prepareDockerReadRequest } from './lib/docker-operation-input.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { readWorkflowResponseBody } from './lib/workflow-response-body.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { approvedDockerOperation } from './lib/secrets/docker-policy.ts';
import { credentialResultProfile, privateResultInputKeys } from './lib/credential-results.ts';
import { prepareCredentialResults } from './lib/secrets/credential-results.ts';
import { assertDockerPrivateBindings, dockerHttpRedactions, prepareDockerAuthResult } from './lib/secrets/docker-http.ts';
import { vaultLimits } from './lib/secrets/types.ts';
import dockerContracts from './lib/docker-http-contracts.json' with {type:'json'};
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { DockerCompanionBroker } from './lib/secrets/docker-companion.ts';
import { dockerNativeFixture } from '../tests/docker-native.fixture.mjs';
import { dockerVaultFixture } from '../tests/docker-vault.fixture.mjs';
import { dockerReference,validateDockerConnection } from './lib/secrets/docker-config.ts';
import { privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { readFile } from 'node:fs/promises';
import { redactDockerCredentialExamples } from '../build/docker-credential-examples.mjs';

Then('Docker schema imports and bundled contracts contain only inert credential examples', async () => {
  const join = ['SWMTKN', '1', 'a'.repeat(50), 'b'.repeat(25)].join('-');
  const unlock = ['SWMKEY', '1', 'c'.repeat(43) + '='].join('-');
  const source = { type: 'object', properties: { Worker: { type: 'string', example: join } },
    example: { Worker: join, UnlockKey: unlock }, description: `Example: ${join}` };
  const redacted = redactDockerCredentialExamples(source);
  assert.equal(source.example.Worker, join, 'Import sanitization must not mutate the upstream object');
  assert.deepEqual(redacted, { type: 'object', properties: { Worker: { type: 'string', example: '<docker-swarm-join-token>' } },
    example: { Worker: '<docker-swarm-join-token>', UnlockKey: '<docker-swarm-unlock-key>' }, description: 'Example: <docker-swarm-join-token>' });
  assert.deepEqual(redactDockerCredentialExamples(redacted), redacted);
  for (const [name, value] of [
    ['bundled Docker source', await readServiceSchemaUpstream('docker')],
    ['effective Docker schema', await readServiceSchema('docker')],
    ...await Promise.all(['docker-http-contracts.json', 'credential-results.json'].map(async name =>
      [name, JSON.parse(await readFile(new URL(`./lib/${name}`, import.meta.url), 'utf8'))])),
  ]) assert.equal(/SWM(?:TKN|KEY)-\d-[A-Za-z0-9+/=_-]+/.test(JSON.stringify(value)), false, `${name} must not contain credential-shaped samples`);
});

const origin = 'https://docker.synthetic.example.test/v1.57';
const denied = error => error?.code === 'PERMISSION';
const binding = descriptor => ({ alternative: 0, fingerprint: descriptor.fingerprint, credentials: {} });
async function models() {
  const document = structuredClone(await readServiceSchema('docker'));
  document.servers[0].variables.docker_endpoint.default = origin;
  return { document, operations: inspectServiceSchema(document, 'docker').operations };
}
async function model(id) {
  const { document, operations } = await models(), operation = operations.find(op => op.id === 'docker:' + id);
  assert.ok(operation && !operation.unavailableReason, `${id}: ${operation?.unavailableReason}`);
  return { document, operation, descriptor: operation.dockerNative ? undefined : await approvedOperation(operation, origin) };
}
const decode = (operation, text, type = 'application/json') => readWorkflowResponseBody(new Response(text, { headers: { 'Content-Type': type } }), operation, 'GET', new AbortController().signal);

Then('Docker HTTP source corrections preserve all native routes and refuse source drift', async () => {
  const raw = await readServiceSchemaUpstream('docker'), before = JSON.stringify(raw);
  assert.equal(createHash('sha256').update(before).digest('hex'), dockerHttpSourceSha256);
  const fixed = applySchemaPatches(raw, [dockerHttpContracts]); assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(fixed['x-upstream-docker-http'].servers, raw.servers);
  const { document, operations } = await models(); assert.equal(operations.length, 108);
  for (const operation of operations) {
    assert.equal(operationInsertionBlockReason(operation), undefined, `${operation.id}: ${operation.unavailableReason}`);
    assert.equal(operationServerUrl(document, operation), origin);
    assert.equal(raw.paths[operation.path][operation.method.toLowerCase()].operationId, operation.id.slice(7));
  }
  for (const mutate of [d => { d.info.version = 'unreviewed'; }, d => { d.paths['/unknown'] = { get: { operationId: 'unknown' } }; },
    d => { d.paths['/auth'].post.responses['200'].content = {}; }, d => { d.servers = [{ url: 'https://unexpected.test' }]; }]) {
    const changed = structuredClone(raw); mutate(changed); const prior = JSON.stringify(changed);
    assert.throws(() => bindDockerHttp(changed), /reviewed native contract/); assert.equal(JSON.stringify(changed), prior);
  }
  for (const endpoint of ['https://docker.test/v1.57', 'http://127.0.0.1:2375/v1.57', 'https://docker.test/proxy/v1.57/']) assert.ok(dockerHttpEndpoint(endpoint));
  for (const endpoint of ['https://u:p@docker.test/v1.57', 'https://docker.test/v1.57?key=a', 'https://docker.test/v1.57#x',
    'https://docker.test/v1.56', 'https://docker.test/%2f/v1.57', 'https://docker.test/a/../v1.57']) assert.throws(() => dockerHttpEndpoint(endpoint));
  assert.throws(() => dockerReadOperations(['docker:ContainerDelete']));
  assert.throws(() => dockerReadOperations([dockerNativeOperationId, dockerNativeOperationId]));
  assert.deepEqual(dockerReadOperations(), [dockerNativeOperationId]);
  const image = await model('ImageCreate'), request = prepareRequest(image.operation, { 'query:fromImage': 'synthetic:latest' });
  assert.equal(request.body, undefined); assert.equal(request.query.fromImage, 'synthetic:latest');
});

Then('Docker HTTP progress and events decode bounded JSON lines including legacy media labels', async () => {
  for (const id of dockerProgressIds) {
    const { operation } = await model(id), expected = [{ status: 'Downloading Ω', id: 'layer' }, { aux: { ID: 'sha256:synthetic' } }];
    for (const type of ['application/json', 'application/x-ndjson']) {
      const result = await decode(operation, expected.map(value => JSON.stringify(value)).join('\r\n'), type);
      assert.deepEqual(result.body, { messages: expected }, id); assert.equal(result.stream.events, 2);
      assert.equal(result.transportMediaType, type); assert.equal(result.mediaType, 'application/json');
    }
    assert.deepEqual((await decode(operation, '')).body, { messages: [] });
    await assert.rejects(decode(operation, '{"status":"started"}\n{"errorDetail":{"message":"synthetic failure"},"error":"synthetic failure"}\n'), error => error.code === 'PROVIDER');
    await assert.rejects(decode(operation, '{"status":'), error => error.code === 'FRAME');
    await assert.rejects(decode(operation, '[]\n'), error => error.code === 'FRAME');
  }
  const { operation } = await model('SystemEvents'), event = { Type: 'container', Action: 'start', time: 1, Actor: { ID: 'synthetic' } };
  const result = await decode(operation, JSON.stringify(event) + '\n'); assert.deepEqual(result.body, event); assert.equal(result.stream.events, 1);
  const ordinary = await model('SystemInfo'); assert.deepEqual((await decode(ordinary.operation, '{"ID":"synthetic"}')).body, { ID: 'synthetic' });
});

Then('Docker HTTP registry and signing inputs require private bindings and redact decoded values', async () => {
  const username = 'SYNTHETIC_REGISTRY_USERNAME_012', password = 'SYNTHETIC_REGISTRY_PASSWORD_012';
  const auth = Buffer.from(JSON.stringify({ username, password, auth: Buffer.from(username + ':' + password).toString('base64') })).toString('base64url');
  const record = { id: crypto.randomUUID(), label: 'Registry fixture', value: auth, kind: 'secret', grants: [] };
  for (const id of ['ImageBuild', 'ImageCreate', 'ImagePush', 'PluginPull', 'PluginPush', 'PluginUpgrade', 'ServiceCreate', 'ServiceUpdate', 'GetPluginPrivileges', 'DistributionInspect', 'ImageSearch']) {
    const { operation, descriptor } = await model(id), key = id === 'ImageBuild' ? 'header:X-Registry-Config' : 'header:X-Registry-Auth';
    assert.ok(privateResultInputKeys(operation).includes(key), id);
    const values = { [key]: vaultVariablePlaceholder };
    for (const field of operation.fields.filter(field => field.required && field.key !== key && (field.location !== 'body' || operation.bodyRequired))) values[field.key] = field.type === 'json'
      ? JSON.stringify(field.schema?.type === 'array' ? [] : {}) : field.type === 'integer' ? '1' : field.type === 'boolean' ? 'false' : 'synthetic';
    if (id === 'ImageCreate') values['query:fromImage'] = 'synthetic:latest';
    if (id === 'ImageBuild') values['body:$'] = JSON.stringify(encodeWorkflowBinary('context.tar', Buffer.from('synthetic tar fixture')));
    let calls = 0;
    const options = { assertCurrent() {}, variables: [{ key, path: [], credentialId: record.id }], fetchRequest: async (_url, init) => {
      calls++; assert.equal(init.headers.get(key.slice(7)), auth); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
      return operation.responseStream ? new Response(JSON.stringify({ status: password, detail: username }) + '\n', { headers: { 'Content-Type': 'application/json' } })
        : Response.json({ message: password, detail: username });
    } };
    const result = await executeCredentialed(descriptor, values, binding(descriptor), [record], options).catch(error => { error.message = id + ': ' + error.message; throw error; });
    assert.equal(calls, 1); noSecrets(result, [auth, username, password]);
    await assert.rejects(executeCredentialed(descriptor, { ...values, [key]: auth }, binding(descriptor), [record], options), denied); assert.equal(calls, 1);
  }
  const { operation } = await model('SwarmUpdate'), raw = { 'body:CAConfig': JSON.stringify({ SigningCAKey: password }) };
  assert.throws(() => assertDockerPrivateBindings(operation, raw, []), denied);
  assertDockerPrivateBindings(operation, { 'body:CAConfig': JSON.stringify({ SigningCAKey: vaultVariablePlaceholder }) },
    [{ key: 'body:CAConfig', path: ['SigningCAKey'], credentialId: record.id }]);
  const original = (await model('PluginPush')).operation, alias = { ...original, fields: original.fields.map(field => field.name === 'X-Registry-Auth'
    ? { ...field, name: 'x-registry-auth', key: 'header:x-registry-auth' } : field) };
  assert.ok(privateResultInputKeys(alias).includes('header:x-registry-auth'));
  const descriptor = await approvedOperation(alias, origin);
  await assert.rejects(executeCredentialed(descriptor, { 'path:name': 'synthetic', 'header:x-registry-auth': auth }, binding(descriptor), [record],
    { assertCurrent() {}, fetchRequest: async () => { assert.fail('A raw header alias reached fetch.'); } }), denied);
});

Then('Docker HTTP registry and swarm results adopt credentials without publishing their raw values', async () => {
  const token = 'SYNTHETIC_DOCKER_IDENTITY_TOKEN_012', previous = globalThis.fetch;
  for (const [id, body, paths] of [
    ['SystemAuth', { Status: 'Login Succeeded', IdentityToken: token }, [['IdentityToken']]],
    ['SwarmInspect', { ID: 'synthetic', JoinTokens: { Worker: token + '_WORKER', Manager: token + '_MANAGER' }, Spec: { CAConfig: { SigningCAKey: token + '_CA' } } }, [['JoinTokens', 'Worker'], ['JoinTokens', 'Manager'], ['Spec', 'CAConfig', 'SigningCAKey']]],
    ['SwarmUnlockkey', { UnlockKey: token + '_UNLOCK' }, [['UnlockKey']]],
  ]) {
    const { operation, descriptor } = await model(id), vault = await privateVault(), secrets = paths.map(path => path.reduce((parent, key) => parent[key], body));
    let calls = 0; globalThis.fetch = async () => { calls++; return Response.json(body); };
    try {
      const result = await vault.session.execute(descriptor, {}, binding(descriptor)); assert.equal(calls, 1); noSecrets(result, secrets);
      for (const [index, path] of paths.entries()) { const reference = path.reduce((parent, key) => parent[key], result.response.body); assert.equal(await vault.session.copyCredential(reference.credentialId), secrets[index]); }
      assert.equal(JSON.stringify(vault.storage.state).includes(token), false);
      await vault.session.lock(); await vault.session.unlock(vault.proof);
      assert.equal((await vault.session.list()).length, paths.length);
    } finally { vault.session.lock(); globalThis.fetch = previous; }
  }
  const { operation } = await model('SystemAuth'), contract = credentialResultProfile(operation);
  for (const body of [{ Status: 'ok' }, { Status: 'ok', IdentityToken: '' }]) assert.equal(prepareCredentialResults(contract, 200, body).values.length, 0);
  assert.equal(prepareCredentialResults(contract, 204, null).complete([]), null);
  for (const body of [{}, { Status: 'ok', IdentityToken: {} }, { Status: 'ok', IdentityToken: '\ud800' }]) assert.throws(() => prepareCredentialResults(contract, 200, body));
  assert.throws(() => prepareCredentialResults(contract, 204, { token }));
  assert.throws(() => prepareCredentialResults(contract, 200, { Status: 'ok', IdentityToken: token }).complete([{ credentialId: {}, label: 'forged' }]));
});

Then('Docker HTTP secret reads reject unexpected private data in JSON or legacy text replies', async () => {
  for (const id of ['SecretInspect', 'SecretList']) {
    const { operation } = await model(id), secret = { ID: 'synthetic', Spec: { Name: 'public-name' } };
    for (const type of ['application/json', 'text/plain']) {
      const body = id === 'SecretList' ? [secret] : secret;
      assert.deepEqual((await decode(operation, JSON.stringify(body), type)).body, body);
      const unsafe = { ...secret, Spec: { ...secret.Spec, Data: 'SYNTHETIC_UNEXPECTED_SECRET' } };
      await assert.rejects(decode(operation, JSON.stringify(id === 'SecretList' ? [unsafe] : unsafe), type));
      await assert.rejects(decode(operation, 'not-json', type));
    }
  }
});

async function attachmentFixture() {
  const f = await dockerNativeFixture({ operations: [...dockerReadOperationIds], operation: dockerNativeAttachOperationId, socketName: 'engine:read?.sock' });
  const broker = new DockerCompanionBroker(f.runtime), guard = async () => {};
  const pair = () => broker.check(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, undefined, guard, undefined, dockerNativeAttachOperationId);
  const read = (identity, params = { id: 'synthetic' }, signal) => broker.read(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, identity, params, guard, signal, dockerNativeAttachOperationId);
  return { f, broker, pair, read, async close() { broker.clear(); await f.close(); } };
}
Then('Docker read only attachment preserves real WebSocket bytes and exact pairing scope', async () => {
  const ordinary = await dockerNativeFixture();
  try { const answer = await ordinary.call('/v1/docker/pair', { profile: 'docker-unix-read-v1', scope: { ...ordinary.scope, operation: dockerNativeAttachOperationId } }); assert.equal(answer.value.error, 'PERMISSION'); assert.equal(ordinary.engineRequests.length, 0); }
  finally { await ordinary.close(); }
  const v = await attachmentFixture();
  try {
    const bytes = [Buffer.from([0, 255, 13, 10]), Buffer.from('output Ω\n')]; v.f.attachment = bytes;
    const pair = await v.pair(), result = await v.read(pair.identity);
    assert.equal(result.status, 101); assert.equal(result.bodyType, 'binary'); assert.deepEqual(Buffer.from(result.body.base64, 'base64'), Buffer.concat(bytes));
    const request = v.f.engineRequests.find(row => row.path.includes('/attach/ws')); assert.ok(request);
    assert.equal(request.authorization, false); assert.equal(request.cookie, false); assert.equal(v.f.stdinMessages, 0);
    const query = new URL(request.path, 'http://fixture').searchParams; assert.equal(query.get('stdin'), 'false'); assert.equal(query.get('logs'), 'true');
    const before = v.f.engineRequests.length, changed = await v.f.call('/v1/docker/read', { profile: 'docker-unix-read-v1', scope: { ...pair.scope, operation: dockerNativeOperationId }, identity: pair.identity, params: {} });
    assert.equal(changed.value.error, 'DOCKER_AUTHORITY'); assert.equal(v.f.engineRequests.length, before);
    const { operation, document } = await model('ContainerAttachWebsocket');
    const scoped = scopeOperationSchema(document, operation.path, operation.method, true).schema;
    await approvedDockerOperation(operation, scoped); await assert.rejects(approvedOperation(operation, origin), denied);
    assert.equal(prepareDockerReadRequest(operation, { 'path:id': '/synthetic' }).query.id, 'synthetic');
    assert.throws(() => prepareDockerReadRequest(operation, { 'path:id': 'synthetic', 'query:stdin': 'true' }));
  } finally { await v.close(); }
});

Then('Docker read only attachment rejects stdin oversized truncated and cancelled responses', async () => {
  for (const input of [{ id: '../other' }, { id: 'synthetic', stdin: true }, { id: 'synthetic', command: 'write' }, { id: 'synthetic', stdout: 'true' }]) assert.throws(() => dockerAttachParams(input));
  for (const mode of ['oversize', 'truncated', 'cancelled']) {
    const v = await attachmentFixture();
    try {
      const pair = await v.pair(), controller = new AbortController();
      if (mode === 'oversize') v.f.attachment = [Buffer.alloc(300_000), Buffer.alloc(300_000)];
      if (mode === 'truncated') v.f.attachmentCode = 1006;
      if (mode === 'cancelled') v.f.attachmentHold = true;
      const result = v.read(pair.identity, { id: 'synthetic' }, controller.signal);
      if (mode === 'cancelled') { await new Promise(resolve => setTimeout(resolve, 50)); controller.abort(); }
      await assert.rejects(result, error => ['LIMIT', 'DOCKER_UNAVAILABLE', 'CANCELLED'].includes(error.code));
      assert.equal(v.broker.connected(v.f.scope.connectionId), false);
    } finally { await v.close(); }
  }
});

Then('Docker read only attachment uses encrypted profiles and withholds binary credential echoes', async () => {
  const v = await attachmentFixture(), vault = await dockerVaultFixture(v.f);
  try {
    const connection = await vault.session.pairDockerHost(vault.input, vault.selection), approved = await approvedDockerOperation(vault.selection.operation, vault.selection.document);
    assert.equal(connection.operation, dockerNativeAttachOperationId);
    const input = { host: dockerReference(connection), fingerprint: approved.fingerprint };
    const result = await vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }); assert.equal(result.response.status, 101);
    assert.equal(JSON.stringify(vault.storage.state).includes(v.f.key), false);
    await vault.session.lock(); await vault.session.unlock(vault.proof);
    v.f.attachment = [Buffer.from(v.f.key)];
    await assert.rejects(vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }), error => error.code === 'REDACTED');
    v.f.attachment = [Buffer.from('safe')]; vault.enabled = false;
    await assert.rejects(vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }), denied);
  } finally { vault.session.lock(); await v.close(); }
});

Then('Docker attachment results cannot publish other vault secrets as raw or encoded bytes',async()=>{
  const value=await attachmentFixture(),vault=await dockerVaultFixture(value.f);
  try{
    const connection=await vault.session.pairDockerHost(vault.input,vault.selection),descriptor=await approvedDockerOperation(vault.selection.operation,vault.selection.document);
    const binding={host:dockerReference(connection),fingerprint:descriptor.fingerprint};
    for(const [secret,bytes] of [['owned-private-Docker-output-70419',Buffer.from('owned-private-Docker-output-70419')],['YWJj',Buffer.from('abc')]]){
      await vault.session.put(null,{label:secret==='YWJj'?'Encoded private Docker output':'Raw private Docker output',kind:'secret',value:secret});value.f.attachment=[bytes];
      if(secret==='YWJj'){assert.equal(bytes.includes(Buffer.from(secret)),false);assert.equal(bytes.toString('base64'),secret);}
      await assert.rejects(vault.session.executeDockerRead(binding,vault.selection,{'path:id':'synthetic'}),error=>error.code==='REDACTED'&&!error.message.includes(secret));
    }
  }finally{vault.session.lock();await value.close();}
});

Then('Docker private helpers preserve nested-key redaction empty auth results and native read limits',async()=>{
  const operation=id=>({id:'docker:'+id,...dockerContracts.routes[id],fields:[]});
  const init=operation('SwarmInit'),secret=operation('SecretCreate'),reference={credentialId:'11111111-1111-4111-8111-111111111111',label:'Owned fixture'};
  assert.equal(dockerHttpOperation({id:'docker:Unknown',method:'GET',path:'/'}),undefined);
  assert.equal(dockerHttpOperation({...init,path:'/foreign'}),undefined);
  for(const value of [undefined,'{','null','0',JSON.stringify({CAConfig:null}),JSON.stringify({CAConfig:{SigningCAKey:''}})]){
    assert.equal(hasDockerNestedPrivateInput(init,{'body:Spec':value}),false);
    assert.doesNotThrow(()=>assertDockerPrivateBindings(init,{'body:Spec':value},[]));
  }
  const nested=JSON.stringify({CAConfig:{SigningCAKey:'OWNED_SIGNING_PRIVATE_VALUE_85217'}});
  assert.equal(hasDockerNestedPrivateInput(init,{'body:Spec':nested}),true);
  assert.throws(()=>assertDockerPrivateBindings(init,{'body:Spec':nested},[]),denied);
  assert.doesNotThrow(()=>assertDockerPrivateBindings(init,{'body:Spec':vaultVariablePlaceholder},[{key:'body:Spec',path:[],credentialId:reference.credentialId}]));
  const placeholder=JSON.stringify({CAConfig:{SigningCAKey:vaultVariablePlaceholder}});
  assert.doesNotThrow(()=>assertDockerPrivateBindings(init,{'body:Spec':placeholder},[{key:'body:Spec',path:['CAConfig','SigningCAKey'],credentialId:reference.credentialId}]));
  const key=Buffer.from('OWNED_PRIVATE_KEY_85217').toString('base64');
  assert.ok(dockerHttpRedactions(init,{body:{Spec:{CAConfig:{SigningCAKey:key}}}}).includes('OWNED_PRIVATE_KEY_85217'));
  assert.ok(dockerHttpRedactions(init,{body:{Spec:{CAConfig:{SigningCAKey:'!'}}}}).includes('!'));
  assert.deepEqual(dockerHttpRedactions(init,{body:{Spec:1}}),[]);
  assert.ok(dockerHttpRedactions(secret,{body:{Data:key}}).includes('OWNED_PRIVATE_KEY_85217'));
  assert.doesNotThrow(()=>dockerHttpRedactions(secret,{body:{Data:Buffer.from(Uint8Array.of(255)).toString('base64')}}));
  const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.throws(()=>dockerHttpRedactions(init,{headers:{'X-Registry-Auth':'x'.repeat(vaultLimits.secretBytes+1)}}),error=>error.code==='LIMIT');
  for(const value of [Buffer.from('{').toString('base64url'),encoded(null),encoded([])])
    assert.throws(()=>dockerHttpRedactions(init,{headers:{'X-Registry-Auth':value}}),error=>error.code==='INVALID');
  assert.deepEqual(dockerHttpRedactions({id:'other',method:'GET',path:'/',fields:[]},{headers:{'X-Registry-Auth':'unparsed'}}),[]);
  const empty=prepareDockerAuthResult(204,null);assert.equal(empty.complete([]),null);assert.throws(()=>empty.complete([reference]),error=>error.code==='INVALID');
  assert.deepEqual(prepareDockerAuthResult(200,{Status:'OK'}).complete([]),{Status:'OK'});
  assert.deepEqual(prepareDockerAuthResult(200,{Status:'OK',IdentityToken:''}).complete([]),{Status:'OK',IdentityToken:null});
  assert.throws(()=>prepareDockerAuthResult(200,{Status:'OK',IdentityToken:'x'.repeat(vaultLimits.secretBytes+1)}),error=>error.code==='LIMIT');
  const token=prepareDockerAuthResult(200,{Status:'OK',IdentityToken:'OWNED_REGISTRY_TOKEN_85217'});
  assert.throws(()=>token.complete([]),error=>error.code==='INVALID');assert.deepEqual(token.complete([reference]),{Status:'OK',IdentityToken:reference});
  const server=value=>({'x-operations-docker-server':dockerHttpProfile,url:'{docker_endpoint}',variables:{docker_endpoint:value}});
  assert.doesNotThrow(()=>validateDockerHttpServer(server({default:origin,enum:[origin]})));
  for(const value of [{default:origin,enum:'bad'},{default:origin,enum:[]},{default:42,enum:[42]}])assert.throws(()=>validateDockerHttpServer(server(value)));
  for(const value of [null,[],1])assert.throws(()=>dockerAttachParams(value),/attachment parameters/);
  for(const detachKeys of [1,'x'.repeat(257),'bad\n'])assert.throws(()=>dockerAttachParams({id:'owned',detachKeys}),/attachment parameters/);
  assert.throws(()=>dockerOperationParams('docker:Unknown',{}),/Unsupported Docker/);
  assert.equal(dockerAttachReadPath({id:'owned',logs:undefined,stdout:undefined,stderr:undefined,stdin:undefined}),'/v1.57/containers/owned/attach/ws');
  const list=await model('ContainerList'),header={key:'header:X-Fixture',name:'X-Fixture',label:'Fixture',description:'',location:'header',type:'string',required:false,schema:{type:'string'}};
  assert.throws(()=>prepareDockerReadRequest({...list.operation,fields:[...list.operation.fields,header]},{'header:X-Fixture':'blocked'}),/does not accept a body or custom headers/);
});

Then('Docker secret decoders and public executors reject malformed frames and private routes',async()=>{
  for(const id of ['SecretList','SecretInspect']){
    const {operation}=await model(id),wrap=value=>id==='SecretList'?[value]:value;
    for(const body of id==='SecretList'?[{},null,1]:[[],null,1])await assert.rejects(decode(operation,JSON.stringify(body)),error=>error.code==='FRAME');
    for(const row of [null,[],1,{Spec:null},{Spec:[]},{Spec:'bad'}])await assert.rejects(decode(operation,JSON.stringify(wrap(row))),error=>error.code==='FRAME');
  }
  const {document,operations:docker}=await models(),attach=docker.find(operation=>operation.id===dockerNativeAttachOperationId),init=docker.find(operation=>operation.id==='docker:SwarmInit');
  const previous=catalogs.map(catalog=>({catalog,operations:operations.filter(operation=>operation.id.startsWith(catalog.id+':')),sourceIdentity:operationSourceIdentity(catalog.id+':')??'docker-original-source'}));
  publishPreparedCatalogs([...previous.filter(entry=>entry.catalog.id!=='docker'),{catalog:{id:'docker',name:'Docker transport boundary',file:'docker.json',document,groups:[],execution:{kind:'http',origin}},operations:docker,sourceIdentity:'docker-private-transport-boundary'}]);
  try{
    let fetches=0;const execution=createWorkflowRequestExecution(async()=>{fetches++;return Response.json({});});
    await assert.rejects(execution.execute(attach,{'path:id':'owned'}),denied);
    await assert.rejects(execution.execute(init,{'body:Spec':JSON.stringify({CAConfig:{SigningCAKey:'OWNED_PRIVATE_KEY_83641'}})}),denied);
    assert.equal(fetches,0);
  }finally{publishPreparedCatalogs(previous);}
  assert.throws(()=>prepareDockerReadRequest(attach,{'path:id':'../owned'}),error=>error.fieldKey==='path:id'&&/Stdin is not authorized/.test(error.message));
  assert.deepEqual(dockerHttpRedactions(docker.find(operation=>operation.id==='docker:SecretCreate'),{body:{Data:42}}),[]);
});

Then('Docker attachment models and companion replies retain exact read authority',async()=>{
  const {document,operation}=await model('ContainerAttachWebsocket'),base={id:operation.id,method:operation.method,path:operation.path};
  const minimal={info:structuredClone(document.info),paths:{[operation.path]:structuredClone(document.paths[operation.path])}};
  delete minimal.paths[operation.path].get.summary;
  assert.equal(dockerNativeReadOperation(minimal,base).name,'Read container attachment');
  for(const mutate of [d=>{d.security={};},d=>{d.paths[operation.path].security=[{}];},d=>{d.paths[operation.path].get.parameters=[];},
    d=>{delete d.paths[operation.path].get.responses['101'].content;},d=>{d.paths[operation.path].get['x-operations-credential-result']=true;}]){
    const changed=structuredClone(minimal);mutate(changed);assert.equal(dockerNativeReadOperation(changed,base),undefined);
  }
  assert.equal(dockerNativeReadOperation(minimal,{...base,method:'POST'}),undefined);
  const raw=await readServiceSchemaUpstream('docker'),addition=dockerContracts.registryHeaderAdditions[0],route=dockerContracts.routes[addition],item=raw.paths[route.path],target=item[route.method.toLowerCase()];
  const valid=structuredClone(raw);valid.paths[route.path].summary='Owned Docker path metadata';bindDockerHttp(valid);
  assert.equal(valid.paths[route.path].summary,'Owned Docker path metadata');assert.ok(valid.paths[route.path][route.method.toLowerCase()].parameters.some(field=>field.name==='X-Registry-Auth'));
  item.parameters=target.parameters;delete target.parameters;const before=JSON.stringify(raw);
  assert.throws(()=>bindDockerHttp(raw),/PluginPush parameters/);assert.equal(JSON.stringify(raw),before);
  const uuid='11111111-1111-4111-8111-111111111111',identity={hostId:uuid,generation:uuid,configuration:'a'.repeat(64),socket:'b'.repeat(64),daemonId:'owned-daemon-83641',apiVersion:'1.57'},host='https://127.0.0.1:7643',now=1700000000000;
  const stored={id:uuid,revision:1,fingerprint:'c'.repeat(64),label:'Owned Docker',host,pairingKeyId:uuid,profile:'docker-unix-read-v1',keyHash:'d'.repeat(64),modelFingerprint:'e'.repeat(64),identity};
  assert.deepEqual(validateDockerConnection(stored),stored);
  const broker=new DockerCompanionBroker({now:()=>now,fetchRequest:async(url,init)=>{
    const {profile,scope}=JSON.parse(init.body);
    return Response.json(url.endsWith('/pair')?{profile,scope,identity,expiresAt:now+1000}:{profile,scope,identity,response:{status:101,statusText:'Switching Protocols',headers:{},mediaType:'application/octet-stream',bodyType:'text',body:encodeWorkflowBinary('owned.bin',Uint8Array.of(1))}});
  }});
  try{await assert.rejects(broker.read(uuid,host,'k'.repeat(43),'f'.repeat(64),identity,{id:'owned'},async()=>{},undefined,dockerNativeAttachOperationId),error=>error.code==='DOCKER_UNAVAILABLE');assert.equal(broker.connected(uuid),false);}
  finally{broker.clear();}
});
