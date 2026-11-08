// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/aws-json-operations.json' with { type: 'json' };
import pins from './lib/aws-json-pins.json' with { type: 'json' };
import { awsJsonContracts, awsJsonContract, awsJsonEndpoint, awsJsonEndpoints, awsJsonInputSchema, awsJsonPattern,
  awsJsonWireRequest, decodeAwsJsonBody, awsJsonDataSha256, maxAwsJsonBytes, configureAwsJson, validAwsJsonModel, awsJsonSigningProfile } from './lib/aws-json.ts';
import { inspectOperationSecurity } from './lib/operation-security.ts';
import { canonicalPolicyValue } from './lib/secrets/policy.ts';
import { signAwsRequest } from './lib/secrets/aws-sigv4.ts';
import { awsSyntheticValues, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const bytes = value => encoder.encode(value);
const bad = error => error?.code === 'CODEC';
const model = id => {
  const contract = awsJsonContracts().operations[id]; assert.ok(contract, id);
  return { id, method: 'POST', path: '/#X-Amz-Target=' + contract.target };
};
const json = wire => JSON.parse(decoder.decode(wire.bytes));
const read = (id, value, type = 'application/json', status = 200) => decodeAwsJsonBody(model(id),
  typeof value === 'string' ? bytes(value) : value, new Headers({ 'Content-Type': type }), status);

Then('every JSON target has a strict canonical input model with its exact authentication choice', () => {
  const security = { components: { securitySchemes: { hmac: { type: 'apiKey', in: 'header', name: 'Authorization',
    'x-amazon-apigateway-authtype': 'awsSigv4' } } }, security: [{ hmac: [] }] };
  for (const id of ids) {
    const contract = awsJsonContracts().operations[id];
    const declaration = { 'x-operations-aws-signing': awsJsonSigningProfile, ...(contract.auth === 'none' ? { security: [] } : {}) };
    const operation = { ...model(id), name: id, description: '', group: 'AWS', fields: [], bodyRequired: false,
      awsJson: awsJsonSigningProfile, security: inspectOperationSecurity(security, declaration) };
    configureAwsJson(operation); assert.equal(validAwsJsonModel(operation), true, id);
    assert.equal(validAwsJsonModel(JSON.parse(canonicalPolicyValue(operation))), true, id + ': canonical approval snapshot');
    if (operation.credentialResult) {
      assert.equal(validAwsJsonModel({ ...operation, credentialResult: undefined }), false, id);
      assert.equal(validAwsJsonModel({ ...operation, credentialResultProfile: undefined }), false, id);
    }
    assert.ok(operation.fields.every(field => field.location === 'body' && field.key === 'body:' + field.name));
    const names = contract.input ? Object.keys(awsJsonContracts().sources[contract.catalog].shapes[contract.input].members ?? {}) : [];
    assert.deepEqual(operation.fields.map(field => field.name), names, id);
    for (const change of [{ awsJsonRevision: 'stale' }, { path: '/' }, { method: 'GET' }, { awsWire: 'dynamodb-list-tables' },
      { fields: [...operation.fields, { key: 'header:X-Amz-Target', name: 'X-Amz-Target', location: 'header', type: 'string', required: false }] },
      { security: contract.auth === 'none' ? [[{ name: 'hmac', kind: 'aws-sigv4', header: 'Authorization', profile: awsJsonSigningProfile }]] : [] }])
      assert.equal(validAwsJsonModel({ ...operation, ...change }), false, id + ': ' + JSON.stringify(Object.keys(change)));
  }
});

Then('all 1784 JSON targets have immutable reviewed wire contracts and finite input schemas', () => {
  const data = awsJsonContracts();
  assert.deepEqual(new Set(Object.keys(data.operations)), new Set(ids)); assert.equal(ids.length, 1784);
  assert.equal(Object.keys(data.sources).length, 28);
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), awsJsonDataSha256);
  for (const [catalog, source] of Object.entries(data.sources)) {
    const { shapes, ...metadata } = source; assert.deepEqual(metadata, pins[catalog]); assert.ok(Object.keys(shapes).length);
    assert.match(source.sdk.url, /^https:\/\/raw\.githubusercontent\.com\/aws\/aws-sdk-js\/v2\.1692\.0\/apis\//);
  }
  for (const id of ids) {
    const operation = model(id), contract = awsJsonContract(operation), source = data.sources[contract.catalog];
    if (contract.input) {
      const schema = awsJsonInputSchema(source, { shape: contract.input });
      assert.equal(schema.type, 'object', id); assert.equal(schema.additionalProperties, false, id);
      assert.ok(JSON.stringify(schema).length < 2 * 1024 * 1024, id);
    }
    for (const endpoint of awsJsonEndpoints(contract)) {
      const origin = endpoint.url.replace(/\{([^{}]+)\}/g, (_, name) => endpoint.variables[name].default);
      assert.deepEqual(awsJsonEndpoint(origin, operation), { service: source.service, region: endpoint.variables.region?.default ?? 'us-east-1' }, id);
      for (const unsafe of [origin.replace('https:', 'http:'), origin + '/prefix', origin + '?x=1', origin + '#x',
        origin + '.evil.example.test', origin.replace('https://', 'https://user:pass@')]) assert.equal(awsJsonEndpoint(unsafe, operation), undefined, unsafe);
    }
    assert.equal(awsJsonContract({ ...operation, method: 'GET' }), undefined);
    assert.equal(awsJsonContract({ ...operation, path: operation.path + '&extra=true' }), undefined);
  }
  assert.throws(() => { data.operations[ids[0]].target = 'changed'; }, TypeError);
});

Then('JSON target codecs preserve versions target headers timestamps and base64 bytes', () => {
  const dynamo = awsJsonWireRequest(model('aws-dynamodb:ExportTableToPointInTime'), {
    TableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/example', S3Bucket: 'example-bucket', ExportTime: '2023-11-14T22:13:20.000Z',
  });
  assert.equal(dynamo.path, '/'); assert.equal(dynamo.headers['Content-Type'], 'application/x-amz-json-1.0');
  assert.equal(dynamo.headers['X-Amz-Target'], 'DynamoDB_20120810.ExportTableToPointInTime');
  assert.equal(json(dynamo).ExportTime, 1700000000);
  const body = { StreamName: 'example', Records: [{ PartitionKey: 'λ', Data: 'AP8ACg==' }] };
  const kinesis = awsJsonWireRequest(model('aws-kinesis:PutRecords'), body);
  assert.equal(kinesis.headers['Content-Type'], 'application/x-amz-json-1.1'); assert.deepEqual(json(kinesis), body);
  assert.deepEqual([...Uint8Array.from(atob(json(kinesis).Records[0].Data), c => c.charCodeAt(0))], [0, 255, 0, 10]);
  assert.deepEqual(read('aws-kms:ScheduleKeyDeletion', '{"KeyId":"key","DeletionDate":1700000000,"KeyState":"PendingDeletion"}'),
    { KeyId: 'key', DeletionDate: '2023-11-14T22:13:20.000Z', KeyState: 'PendingDeletion' });
});

Then('recursive JSON target values reject malformed unknown and out of range input', () => {
  const operation = model('aws-dynamodb:PutItem');
  const input = { TableName: 'example', Item: { pk: { S: 'λ' }, nested: { M: { v: { L: [{ N: '1.25' }, { B: 'AP8=' }, { BOOL: true }] } } } } };
  assert.deepEqual(json(awsJsonWireRequest(operation, input)), input);
  for (const invalid of [
    { Item: input.Item }, { ...input, unexpected: 'value' }, { ...input, Item: { pk: { N: 123 } } },
    { ...input, Item: { pk: { B: 'AB==' } } }, { ...input, Item: { pk: { unknown: 'value' } } },
  ]) assert.throws(() => awsJsonWireRequest(operation, invalid), bad);
  for (const invalid of [{ NumberOfBytes: 0 }, { NumberOfBytes: 1025 }, { NumberOfBytes: 1.5 }])
    assert.throws(() => awsJsonWireRequest(model('aws-kms:GenerateRandom'), invalid), bad);
  assert.throws(() => awsJsonWireRequest(model('aws-kinesis:PutRecords'), { StreamName: 'example', Records: [{ PartitionKey: '', Data: 'AP8=' }] }), bad);
  let nested = { S: 'leaf' }; for (let index = 0; index < 50; index++) nested = { M: { value: nested } };
  assert.throws(() => awsJsonWireRequest(operation, { TableName: 'example', Item: { value: nested } }), { code: 'LIMIT' });
  const many = Array.from({ length: 50001 }, () => ({ S: 'x' }));
  assert.throws(() => awsJsonWireRequest(operation, { TableName: 'example', Item: { value: { L: many } } }), { code: 'LIMIT' });
});

Then('the pinned AWS JSON pattern translations retain Unicode bounds character sets and scoped flags', () => {
  const data = awsJsonContracts(), pattern = (catalog, name) => awsJsonPattern(data.sources[catalog].shapes[name].pattern);
  const matches = (catalog, name, text) => new RegExp(pattern(catalog, name), 'u').test(text);
  assert.equal(matches('aws-budgets', 'BudgetName', 'ordinary budget'), true);
  assert.equal(matches('aws-budgets', 'BudgetName', '<ScRiPt>code</sCrIpT>'), false);
  assert.equal(matches('aws-budgets', 'BudgetName', 'prefix/action/name'), false);
  assert.equal(matches('aws-budgets', 'BudgetName', 'prefix/ACTION/name'), true);
  assert.equal(matches('aws-ce', 'CostCategoryName', '日本語-é_1'), true);
  assert.equal(matches('aws-ce', 'CostCategoryName', ' leading'), false);
  assert.equal(matches('aws-ce', 'CostCategoryName', 'trailing '), false);
  assert.equal(matches('aws-cloudtrail', 'QueryStatement', 'line one\nline two'), true);
  assert.equal(matches('aws-ssm', 'AccountId', 'ALL'), true);
  for (const [name, maximum] of [['CustomerMetadataKey', 128], ['CustomerMetadataValue', 256]]) {
    assert.equal(matches('aws-sagemaker', name, 'é日本_./=+-@'), true);
    assert.equal(matches('aws-sagemaker', name, ''), false);
    assert.equal(matches('aws-sagemaker', name, 'x'.repeat(maximum)), true);
    assert.equal(matches('aws-sagemaker', name, 'x'.repeat(maximum + 1)), false);
    assert.equal(matches('aws-sagemaker', name, '<script>'), false);
  }
  assert.equal(new RegExp('^(?:' + pattern('aws-transfer', 'As2Id') + ')$', 'u').test('ascii\t\n'), true);
  assert.equal(new RegExp('^(?:' + pattern('aws-transfer', 'Description') + ')$', 'u').test('space forbidden'), false);
  assert.equal(new RegExp('^(?:' + pattern('aws-transfer', 'MessageSubject') + ')$', 'u').test('space\tallowed'), true);
  assert.equal(new RegExp('^(?:' + pattern('aws-transfer', 'WorkflowDescription') + ')$', 'u').test('words - allowed'), true);
});

Then('JSON target authentication and host prefixes follow each pinned SDK operation', () => {
  const data = awsJsonContracts(), anonymous = Object.entries(data.operations).filter(([, contract]) => contract.auth === 'none');
  assert.equal(anonymous.length, 26); assert.ok(anonymous.every(([id]) => id.startsWith('aws-cognito-idp:')));
  const input = { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: 'publicclient', AuthParameters: { USERNAME: 'user', PASSWORD: 'synthetic-private-input' } };
  assert.equal(awsJsonWireRequest(model('aws-cognito-idp:InitiateAuth'), input).requiresSignature, false);
  assert.equal(awsJsonWireRequest(model('aws-cognito-idp:AdminInitiateAuth'), { ...input, UserPoolId: 'us-east-1_example' }).requiresSignature, true);
  const sync = model('aws-states:StartSyncExecution'), ordinary = model('aws-states:StartExecution');
  assert.deepEqual(awsJsonEndpoint('https://sync-states.us-east-1.amazonaws.com', sync), { service: 'states', region: 'us-east-1' });
  assert.equal(awsJsonEndpoint('https://states.us-east-1.amazonaws.com', sync), undefined);
  assert.equal(awsJsonEndpoint('https://sync-states.us-east-1.amazonaws.com', ordinary), undefined);
  assert.deepEqual(awsJsonEndpoint('https://budgets.amazonaws.com', model('aws-budgets:DescribeBudgets')), { service: 'budgets', region: 'us-east-1' });
  assert.deepEqual(awsJsonEndpoint('https://api.ecr.us-east-1.amazonaws.com', model('aws-ecr:GetAuthorizationToken')), { service: 'ecr', region: 'us-east-1' });
  assert.deepEqual(awsJsonEndpoint('https://api.sagemaker.us-east-1.amazonaws.com', model('aws-sagemaker:ListModels')), { service: 'sagemaker', region: 'us-east-1' });
});

Then('independently verified AWS signatures bind JSON target headers and payloads', async () => {
  const operation = model('aws-kinesis:PutRecords'), address = 'https://kinesis.us-east-1.amazonaws.com/';
  const wire = awsJsonWireRequest(operation, { StreamName: 'example', Records: [{ PartitionKey: 'one', Data: 'AP8=' }] });
  const context = { ...awsJsonEndpoint(address, operation), now: () => 1700000000000 };
  const signed = await signAwsRequest(wire.method, address, new Headers(wire.headers), wire.bytes, awsSyntheticValues, context);
  verifyAwsSignature(address, { method: wire.method, headers: signed.headers, body: signed.body }, awsSyntheticValues, 'kinesis');
  assert.match(signed.headers.get('Authorization'), /SignedHeaders=[^,]*content-type[^,]*x-amz-target/);
  assert.deepEqual(signed.body, wire.bytes);
  const changed = new Headers(signed.headers); changed.set('X-Amz-Target', 'Other.Operation');
  assert.throws(() => verifyAwsSignature(address, { method: 'POST', headers: changed, body: signed.body }, awsSyntheticValues, 'kinesis'));
  assert.throws(() => verifyAwsSignature(address, { method: 'POST', headers: signed.headers, body: bytes('{}') }, awsSyntheticValues, 'kinesis'));
});

Then('JSON target responses preserve typed outputs and reject invalid wire representations', () => {
  const id = 'aws-kms:GenerateRandom';
  assert.deepEqual(read(id, '{"Plaintext":"AP8=","unknown":"discarded"}', 'application/x-amz-json-1.1'), { Plaintext: 'AP8=' });
  assert.deepEqual(read(id, '{"__type":"InvalidRequest","message":"Rejected","unreviewed":"omitted"}', 'application/json', 400),
    { Error: { message: 'Rejected', __type: 'InvalidRequest' } });
  for (const text of ['{', '[]', '{"Plaintext":null}', '{"Plaintext":"AB=="}']) assert.throws(() => read(id, text), bad);
  assert.throws(() => read(id, Uint8Array.of(255)), bad);
  assert.throws(() => read(id, '{}', 'text/html'), { code: 'MEDIA' });
  assert.throws(() => read(id, '{}', 'application/x-amz-json-1.0'), { code: 'MEDIA' });
  assert.throws(() => read(id, new Uint8Array(maxAwsJsonBytes + 1)), { code: 'LIMIT' });
  assert.throws(() => awsJsonWireRequest({ ...model(id), path: '/#X-Amz-Target=unknown' }, {}), bad);
});
