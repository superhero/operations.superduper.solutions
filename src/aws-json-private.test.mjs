// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/aws-json-operations.json' with { type: 'json' };
import policy from './lib/aws-json-private-policy.json' with { type: 'json' };
import descriptionIds from '../tests/aws-json-description-operations.json' with { type: 'json' };
import displayCorrections from './lib/operation-display.json' with { type: 'json' };
import { createOperationGraph } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { awsJsonContracts, awsJsonContract, awsJsonHasPrivateOutput, awsJsonPrivateInputKeys, awsJsonEndpoints,
  awsJsonEndpoint, awsJsonSigningProfile, configureAwsJson, validAwsJsonModel } from './lib/aws-json.ts';
import { projectAwsJsonPrivateResponse } from './lib/aws-json-private.ts';
import { credentialResultProfile, supportsCredentialResults } from './lib/credential-results.ts';
import { prepareCredentialResults } from './lib/secrets/credential-results.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations, updateCatalogs, operationForId } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { awsSyntheticValues, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';
import { privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';

function model(id) {
  const contract = awsJsonContracts().operations[id]; assert.ok(contract, id);
  const operation = { id, name: id, description: '', group: 'AWS', method: 'POST', path: '/#X-Amz-Target=' + contract.target,
    fields: [], bodyRequired: false, awsJson: awsJsonSigningProfile,
    security: contract.auth === 'none' ? [] : [[{ name: 'hmac', kind: 'aws-sigv4', header: 'Authorization', profile: awsJsonSigningProfile }]] };
  configureAwsJson(operation); return operation;
}
function adopted(id, body) {
  const profile = credentialResultProfile(model(id)); assert.ok(profile, id);
  const prepared = prepareCredentialResults(profile, 200, body);
  const references = prepared.values.map(({ field }) => ({ credentialId: crypto.randomUUID(), label: field }));
  const result = prepared.complete(references); noSecrets(result, prepared.values.map(value => value.value));
  return { result, prepared, references };
}
async function native(id) {
  const contract = awsJsonContracts().operations[id], document = await readServiceSchema(contract.catalog);
  const operation = inspectServiceSchema(document, contract.catalog, new Set([id])).operations[0];
  assert.ok(operation && !operation.unavailableReason, JSON.stringify(operation?.capabilities?.issues ?? id));
  const origin = operationServerUrl(document, operation), descriptor = await approvedOperation(operation, origin);
  return { operation, contract, document, origin, descriptor };
}

Then('the twenty four native JSON description synopses persist while the complete source documentation remains available', async () => {
  assert.equal(descriptionIds.length, 24);
  for (const id of descriptionIds) {
    const f = await native(id), before = JSON.stringify(f.document); assert.ok(f.operation.description.length > 4000, id);
    const graph = createOperationGraph(f.operation, { x: 0, y: 0 }, 'fixture', f.document);
    assert.equal(graph.nodes[0].data.description, displayCorrections[id].description);
    const saved = validateWorkflowDocument({ version: 2, id: crypto.randomUUID(), name: 'AWS JSON metadata', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved);
    assert.equal(JSON.stringify(f.document), before);
  }
});

Then('SDK private response schemas retain recursive references and public metadata without changing input components', () => {
  const data = awsJsonContracts();
  for (const [catalog, shapes] of Object.entries(policy.members)) for (const [name, members] of Object.entries(shapes)) for (const member of members) {
    const shape = data.sources[catalog].shapes[name]; assert.ok(shape?.members?.[member], catalog + ':' + name + '.' + member);
    assert.ok(['string', 'blob'].includes(data.sources[catalog].shapes[shape.members[member].shape].type));
  }
  for (const [catalog, shapes] of Object.entries(policy.mapKeys)) for (const name of Object.keys(shapes)) assert.equal(data.sources[catalog].shapes[name]?.type, 'map');
  const document = { components: { schemas: { OriginalInput: { type: 'string', description: 'Preserved upstream input' } } } };
  const original = structuredClone(document.components.schemas.OriginalInput);
  projectAwsJsonPrivateResponse(document, 'aws-glue', 'GetConnectionResponse');
  assert.ok(document.components.schemas.OperationsAwsJsonPrivate_ConnectionProperties.properties.PASSWORD.anyOf);
  assert.ok(document.components.schemas.OperationsAwsJsonPrivate_ConnectionProperties.additionalProperties.$ref);
  projectAwsJsonPrivateResponse(document, 'aws-fsx', 'DescribeFileSystemsResponse');
  assert.equal(document.components.schemas.OperationsAwsJsonPrivate_AdministrativeAction.properties.TargetFileSystemValues.$ref,
    '#/components/schemas/OperationsAwsJsonPrivate_FileSystem');
  assert.ok(document.components.schemas.OperationsAwsJsonPrivate_OntapFileSystemConfiguration.properties.FsxAdminPassword.anyOf);
  projectAwsJsonPrivateResponse(document, 'aws-kms', 'GetParametersForImportResponse');
  assert.ok(document.components.schemas.OperationsAwsJsonPrivate_GetParametersForImportResponse.properties.ImportToken.anyOf);
  assert.ok(document.components.schemas.OperationsAwsJsonPrivate_GetParametersForImportResponse.properties.PublicKey.$ref);
  assert.deepEqual(document.components.schemas.OriginalInput, original);
  assert.equal(awsJsonHasPrivateOutput(model('aws-cognito-idp:AdminGetUser')), false);
  assert.equal(awsJsonHasPrivateOutput(model('aws-kms:GetPublicKey')), false);
});

Then('SDK private adoption handles recursive passwords credential maps tokens and public keys', () => {
  let filesystem = { FileSystemId: 'leaf', OntapConfiguration: { FsxAdminPassword: 'fsx-private-leaf-913' } };
  for (let index = 0; index < 3; index++) filesystem = { FileSystemId: 'parent-' + index,
    OntapConfiguration: { FsxAdminPassword: 'fsx-private-parent-' + index + '-913' }, AdministrativeActions: [{ TargetFileSystemValues: filesystem }] };
  const fsx = adopted('aws-fsx:DescribeFileSystems', { FileSystems: [filesystem], unknown: 'discarded' });
  assert.equal(fsx.prepared.values.length, 4); assert.equal(fsx.result.FileSystems[0].FileSystemId, 'parent-2'); assert.equal(fsx.result.unknown, undefined);
  const glue = adopted('aws-glue:GetConnection', { Connection: { Name: 'metadata', ConnectionProperties: {
    HOST: 'database.example.test', PASSWORD: 'glue-private-password-913', KAFKA_SASL_PLAIN_PASSWORD: 'glue-private-kafka-913', FUTURE_SECRET: 'unreviewed-secret-913',
  } } });
  assert.equal(glue.prepared.values.length, 2); assert.equal(glue.result.Connection.ConnectionProperties.HOST, 'database.example.test');
  assert.equal(glue.result.Connection.ConnectionProperties.FUTURE_SECRET, undefined);
  const job = adopted('aws-codepipeline:GetJobDetails', { jobDetails: { id: 'job-metadata', accountId: '123456789012',
    data: { actionConfiguration: { configuration: Object.fromEntries([
      ['OAuthToken', 'pipeline-private-token-913'], ['Branch', 'pipeline-private-config-913'], ['__proto__', 'pipeline-private-prototype-913'],
    ]) },
      artifactCredentials: { accessKeyId: 'pipeline-private-key-id-913', secretAccessKey: 'pipeline-private-key-913', sessionToken: 'pipeline-private-session-913' } } } });
  assert.equal(job.prepared.values.length, 6); assert.equal(job.result.jobDetails.id, 'job-metadata');
  const configuration = job.result.jobDetails.data.actionConfiguration.configuration;
  assert.equal(Object.getPrototypeOf(configuration), Object.prototype);
  assert.equal(Object.hasOwn(configuration, '__proto__'), true);
  assert.equal(typeof configuration.__proto__.credentialId, 'string');
  const kms = adopted('aws-kms:GetParametersForImport', { KeyId: 'public-key-id', ImportToken: 'aW1wb3J0LXRva2Vu', PublicKey: 'cHVibGljLWtleQ==' });
  assert.equal(kms.prepared.values.length, 1); assert.equal(kms.result.PublicKey, 'cHVibGljLWtleQ=='); assert.equal(kms.result.KeyId, 'public-key-id');
  const masked = adopted('aws-codebuild:CreateWebhook', { webhook: { secret: '***', url: 'https://public.example.test/webhook' } });
  assert.equal(masked.prepared.values.length, 0); assert.equal(masked.result.webhook.secret, null);
  const profile = credentialResultProfile(model('aws-secretsmanager:GetSecretValue'));
  assert.throws(() => prepareCredentialResults({ ...profile, awsJson: { ...profile.awsJson, revision: 'stale' } }, 200, { SecretString: 'withheld' }), { code: 'PERMISSION' });
});

Then('all native AWS JSON targets have matching strict and capability models with qualified private results', async () => {
  const selected = new Set(ids), found = new Set(), failures = [];
  for (const catalog of Object.keys(awsJsonContracts().sources)) {
    const document = await readServiceSchema(catalog), scoped = structuredClone(document);
    scoped.paths = Object.fromEntries(Object.entries(document.paths).filter(([, item]) => selected.has(catalog + ':' + item.post?.operationId)));
    const canonical = inspectServiceSchema(document, catalog, selected).operations, strict = extractOperations(scoped, catalog);
    assert.deepEqual(new Set(strict.map(operation => operation.id)), new Set(canonical.map(operation => operation.id)));
    for (const operation of [...canonical, ...strict]) {
      found.add(operation.id);
      if (operation.unavailableReason || !validAwsJsonModel(operation)) failures.push({ id: operation.id, issues: operation.capabilities?.issues });
      if (awsJsonHasPrivateOutput(operation)) assert.equal(supportsCredentialResults(operation), true, operation.id);
      assert.ok(!operation.fields.some(field => field.location !== 'body'));
    }
  }
  assert.deepEqual(found, selected); assert.deepEqual(failures, []);
});

Then('all twenty eight native JSON providers sign their exact target headers and request bytes', async () => {
  const samples = [
    ['aws-athena:ListDataCatalogs', {}], ['aws-budgets:DescribeBudgets', { AccountId: '123456789012' }],
    ['aws-ce:GetCostAndUsage', { TimePeriod: { Start: '2023-01-01', End: '2023-02-01' }, Granularity: 'MONTHLY', Metrics: ['BlendedCost'] }],
    ['aws-cloudtrail:DescribeTrails', {}], ['aws-codebuild:ListProjects', {}], ['aws-codepipeline:ListPipelines', {}],
    ['aws-cognito-idp:ListUserPools', { MaxResults: 1 }], ['aws-comprehend:ListEntityRecognizers', {}], ['aws-dynamodb:DescribeLimits', {}],
    ['aws-ecr:DescribeRepositories', {}], ['aws-ecs:ListClusters', {}], ['aws-events:ListEventBuses', {}], ['aws-firehose:ListDeliveryStreams', {}],
    ['aws-fsx:DescribeFileSystems', {}], ['aws-glue:GetDatabases', {}], ['aws-kinesis:ListStreams', {}], ['aws-kms:ListKeys', {}],
    ['aws-logs:DescribeLogGroups', {}], ['aws-organizations:ListAccounts', {}], ['aws-rekognition:ListCollections', {}],
    ['aws-sagemaker:ListModels', {}], ['aws-secretsmanager:ListSecrets', {}], ['aws-ssm:DescribeInstanceInformation', {}],
    ['aws-states:ListStateMachines', {}], ['aws-textract:GetDocumentTextDetection', { JobId: 'fixture-job-913' }],
    ['aws-transcribe:ListTranscriptionJobs', {}], ['aws-transfer:ListServers', {}], ['aws-translate:ListTerminologies', {}],
    ['aws-states:StartSyncExecution', { stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:example' }],
  ];
  const providers = new Set(); let calls = 0;
  for (const [id, body] of samples) {
    const f = await native(id), reference = {}, records = [];
    for (const [part, value] of Object.entries(awsSyntheticValues)) {
      reference[part] = crypto.randomUUID(); records.push({ id: reference[part], label: part, kind: 'secret', value, grants: [] });
    }
    const values = Object.fromEntries(Object.entries(body).map(([name, value]) => ['body:' + name, typeof value === 'object' ? JSON.stringify(value) : String(value)]));
    const result = await executeCredentialed(f.descriptor, values, { alternative: 0, fingerprint: f.descriptor.fingerprint, credentials: { hmac: reference } }, records,
      { assertCurrent() {}, async adoptPrivateResults() { assert.fail('An empty FSx inventory has no secret leaves'); }, async fetchRequest(address, init) {
        calls++; providers.add(f.contract.catalog); const target = new URL(address); assert.equal(target.pathname, '/'); assert.equal(target.hash, ''); assert.equal(target.search, '');
        assert.equal(new Headers(init.headers).get('X-Amz-Target'), f.contract.target);
        assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), body);
        const signing = awsJsonEndpoint(f.origin, f.operation); verifyAwsSignature(address, init, awsSyntheticValues, signing.service, signing.region);
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        return new Response(JSON.stringify(id === 'aws-fsx:DescribeFileSystems' ? { FileSystems: [] } : {}),
          { headers: { 'Content-Type': 'application/x-amz-json-' + awsJsonContracts().sources[f.contract.catalog].jsonVersion } });
      } });
    noSecrets(result, Object.values(awsSyntheticValues));
  }
  assert.equal(calls, 29); assert.equal(providers.size, 28);
});

Then('unsigned Cognito authentication adopts results atomically through encrypted vault reload', async () => {
  const f = await native('aws-cognito-idp:InitiateAuth'), vault = await privateVault(), previous = globalThis.fetch;
  const password = 'cognito-private-password-913', issued = ['cognito-issued-access-913', 'cognito-issued-refresh-913', 'cognito-issued-id-913', 'cognito-issued-session-913'];
  const summaries = await vault.session.put(null, { label: 'Cognito password', kind: 'secret', value: password });
  const passwordId = summaries.find(item => item.label === 'Cognito password').id;
  const variables = [{ key: 'body:AuthParameters', path: [], expression: { kind: 'object', entries: {
    USERNAME: { kind: 'literal', value: 'public-user' }, PASSWORD: { kind: 'credential', id: passwordId },
  } } }];
  const values = { 'body:AuthFlow': 'USER_PASSWORD_AUTH', 'body:ClientId': 'publicclient', 'body:AuthParameters': vaultVariablePlaceholder };
  const binding = { alternative: 0, fingerprint: f.descriptor.fingerprint, credentials: {} }; let calls = 0;
  try {
    globalThis.fetch = async (address, init) => {
      calls++; assert.equal(new URL(address).origin, f.origin); assert.equal(new Headers(init.headers).get('Authorization'), null);
      assert.equal(JSON.parse(init.body).AuthParameters.PASSWORD, password);
      const current = calls === 1 ? issued : issued.map(value => value + '-second');
      return Response.json({ AuthenticationResult: { AccessToken: current[0], RefreshToken: current[1], IdToken: current[2], TokenType: 'Bearer', ExpiresIn: 3600 }, Session: current[3] });
    };
    const result = await vault.session.execute(f.descriptor, values, binding, undefined, variables, () => assert.fail('Private progress published'), () => assert.fail('Private value published'));
    noSecrets(result, [password, ...issued]); noSecrets(vault.storage.state, [password, ...issued]); noSecrets(await vault.session.backup(), [password, ...issued]);
    assert.equal(result.response.body.AuthenticationResult.TokenType, 'Bearer');
    const reference = result.response.body.AuthenticationResult.AccessToken;
    assert.equal(await vault.session.copyCredential(reference.credentialId), issued[0]);
    vault.session.lock(); await vault.session.unlock(vault.proof); assert.equal(await vault.session.copyCredential(reference.credentialId), issued[0]);
    const count = vault.storage.state.snapshot.records.length; vault.storage.fail = true;
    await assert.rejects(vault.session.execute(f.descriptor, values, binding, undefined, variables), error => { noSecrets({ message: error.message, response: error.response }, [...issued, ...issued.map(value => value + '-second')]); return true; });
    assert.equal(vault.storage.state.snapshot.records.length, count); assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; vault.session.lock(); }
});

Then('JSON private input and no IAM origin guards reject public passwords before dispatch', async () => {
  const f = await native('aws-cognito-idp:ChangePassword'), values = { 'body:AccessToken': 'private-access-token-913', 'body:PreviousPassword': 'private-old-913', 'body:ProposedPassword': 'private-new-913' };
  assert.equal(f.operation.credentialResult, undefined); assert.deepEqual(awsJsonPrivateInputKeys(f.operation).sort(), Object.keys(values).sort());
  await assert.rejects(approvedOperation(f.operation, 'https://evil.example.test'), { code: 'PERMISSION' });
  let calls = 0; const fetchRequest = async () => { calls++; assert.fail('Public password dispatched'); };
  await assert.rejects(executeCredentialed(f.descriptor, values, { alternative: 0, fingerprint: f.descriptor.fingerprint, credentials: {} }, [],
    { assertCurrent() {}, fetchRequest }), { code: 'PERMISSION' });
  const previous = [...catalogs], scoped = structuredClone(f.document);
  scoped.paths = { [f.operation.path]: scoped.paths[f.operation.path] };
  try {
    updateCatalogs([...previous.filter(item => item.id !== 'aws-cognito-idp'), { id: 'aws-cognito-idp', name: 'Cognito fixture', file: 'cognito-fixture.json',
      document: scoped, groups: [], execution: { kind: 'http', origin: f.origin } }]);
    assert.ok(operationForId(f.operation.id));
    await assert.rejects(createWorkflowRequestExecution(fetchRequest).execute(f.operation, values), { code: 'PERMISSION' });
  } finally { updateCatalogs(previous); }
  assert.equal(calls, 0);
});
