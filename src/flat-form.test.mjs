// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { flatFormPath, flatFormBody, flatFormValues } from '../tests/flat-form.fixture.mjs';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { operationServerUrl } from './lib/schema-documents.ts';

const kinds = ['CreateSiprec', 'CreateStream'];
const native = () => readServiceSchema('twilio');
const inspect = (document, kind, id = 'twilio') => inspectServiceSchema(document, id, new Set([`${id}:${kind}`])).operations[0];
const invalid = key => error => error instanceof InputValidationError && error.fieldKey === key;
function credentials(descriptor) {
  const username = crypto.randomUUID(), password = crypto.randomUUID();
  return { binding: { fingerprint: descriptor.fingerprint, alternative: 0,
    credentials: { accountSid_authToken: { username, password } } }, records: [
    { id: username, label: 'Synthetic user', kind: 'secret', value: 'twilio-form-private-user-1726', grants: [] },
    { id: password, label: 'Synthetic password', kind: 'secret', value: 'twilio-form-private-password-1726', grants: [] },
  ] };
}
Then('the native {string} model retains all 203 form fields and source constraints', async kind => {
  const document = await native(), original = JSON.stringify(document), operation = inspect(document, kind), schema = flatFormBody(document, kind);
  assert.equal(operation.unavailableReason, undefined); assert.equal(operation.id, `twilio:${kind}`);
  assert.equal(operation.method, 'POST'); assert.equal(operation.path, flatFormPath(kind));
  assert.equal(operation.fields.filter(field => field.location === 'body').length, 203);
  assert.deepEqual(Object.keys(operation.bodySchema.properties), Object.keys(schema.properties));
  assert.deepEqual(operation.bodySchema.required, schema.required ?? []);
  for (const name of Object.keys(schema.properties)) {
    const field = operation.fields.find(field => field.key === `body:${name}`);
    assert.equal(field.name, name); assert.equal(field.type, 'string');
  }
  assert.deepEqual(operation.fields.find(field => field.name === 'Track').enum, ['inbound_track', 'outbound_track', 'both_tracks']);
  assert.deepEqual(operation.fields.find(field => field.name === 'StatusCallbackMethod').enum, ['GET', 'POST']);
  assert.equal(operation.fields.find(field => field.name === 'AccountSid').pattern, '^AC[0-9a-fA-F]{32}$');
  assert.equal(JSON.stringify(document), original);
});
Then('the native {string} sends selected flat form fields through canonical private preparation', async kind => {
  const document = await native(), operation = inspect(document, kind), values = flatFormValues(kind);
  const descriptor = await approvedOperation(operation, operationServerUrl(document, operation)), authority = credentials(descriptor); let calls = 0;
  const expected = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('body:')).map(([key, value]) => [key.slice(5), value]));
  await executeCredentialed(descriptor, values, authority.binding, authority.records, { assertCurrent() {}, fetchRequest: async (url, init) => {
    calls++; assert.equal(new URL(url).origin, 'https://api.twilio.com');
    assert.equal(new URL(url).pathname, flatFormPath(kind).replace('{AccountSid}', values['path:AccountSid']).replace('{CallSid}', values['path:CallSid']));
    assert.equal(new Headers(init.headers).get('content-type'), 'application/x-www-form-urlencoded');
    assert.match(new Headers(init.headers).get('authorization'), /^Basic /);
    const form = new URLSearchParams(init.body); assert.deepEqual(Object.fromEntries(form), expected);
    assert.equal(form.has('Parameter2.Name'), false); assert.equal(form.has('Parameter'), false);
    assert.match(form.toString(), /Parameter1\.Name=first\.key/); assert.match(form.toString(), /a%2Bb\+%26\+c%3Dd/);
    return Response.json({ accepted: true });
  } }); assert.equal(calls, 1);
});
Then('the bounded Twilio forms retain all 99 pairs in their actual form encoding', async () => {
  const document = await native();
  for (const kind of kinds) {
    const operation = inspect(document, kind), values = flatFormValues(kind);
    for (let index = 1; index <= 99; index++) for (const suffix of ['Name', 'Value']) values[`body:Parameter${index}.${suffix}`] = `${index}.${suffix} + &`;
    const form = requestBody(prepareRequest(operation, values)); assert.ok(form instanceof URLSearchParams);
    for (let index = 1; index <= 99; index++) for (const suffix of ['Name', 'Value']) assert.equal(form.get(`Parameter${index}.${suffix}`), `${index}.${suffix} + &`);
    assert.equal([...form.keys()].filter(name => name.startsWith('Parameter')).length, 198);
  }
});
Then('the Twilio root exception rejects other identities shapes and oversized nested inputs', async () => {
  for (const kind of kinds) {
    for (const edit of [d => d.info.version = '2', d => d.info.title = 'Other',
      d => flatFormBody(d, kind).properties.Extra = { type: 'string' },
      d => { const p = flatFormBody(d, kind).properties; delete p['Parameter99.Value']; p['Parameter100.Value'] = { type: 'string' }; },
      d => flatFormBody(d, kind).properties['Parameter99.Value'] = { type: 'object', properties: { value: { type: 'string' } } },
      d => flatFormBody(d, kind).nullable = true,
      d => flatFormBody(d, kind).required = ['Name'],
      d => { const item = d.paths[flatFormPath(kind)]; item.put = item.post; delete item.post; }]) {
      const d = await native(); edit(d); assert.ok(inspect(d, kind).unavailableReason, kind);
    }
    assert.ok(inspect(await native(), kind, 'other-twilio').unavailableReason);
    const renamed = await native(); renamed.paths['/unreviewed'] = renamed.paths[flatFormPath(kind)]; delete renamed.paths[flatFormPath(kind)];
    assert.ok(inspect(renamed, kind).unavailableReason);
    const nested = await native(); flatFormBody(nested, kind).properties['Parameter1.Value'] = { type: 'object', properties: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, { type: 'string' }])) };
    assert.ok(inspect(nested, kind).unavailableReason);
    const ordinary = await native(), properties = flatFormBody(ordinary, kind).properties;
    delete properties['Parameter99.Name']; delete properties['Parameter99.Value'];
    assert.equal(Object.keys(properties).length, 201); assert.ok(inspect(ordinary, kind).unavailableReason);
    delete properties['Parameter98.Value'];
    assert.equal(Object.keys(properties).length, 200); assert.equal(inspect(ordinary, kind).unavailableReason, undefined);
  }
});
Then('bounded Twilio form fields keep requiredness enums and omission semantics', async () => {
  const document = await native();
  for (const kind of kinds) {
    const operation = inspect(document, kind), values = flatFormValues(kind);
    assert.equal(requestBody(prepareRequest(operation, { 'path:AccountSid': values['path:AccountSid'], 'path:CallSid': values['path:CallSid'] })), null);
    for (const [key, value] of [['body:Track', 'wrong'], ['body:StatusCallbackMethod', 'PUT'], ['path:AccountSid', 'wrong']])
      assert.throws(() => prepareRequest(operation, { ...values, [key]: value }), invalid(key));
    if (kind === 'CreateStream') { delete values['body:Url']; assert.throws(() => prepareRequest(operation, values), invalid('body:Url')); }
    else assert.equal(requestBody(prepareRequest(operation, values)).has('Parameter2.Value'), false);
  }
});
Then('changing a bounded Twilio field invalidates its previous private approval', async () => {
  const document = await native(), operation = inspect(document, 'CreateStream'), origin = operationServerUrl(document, operation);
  const first = await approvedOperation(operation, origin), authority = credentials(first);
  flatFormBody(document, 'CreateStream').properties['Parameter99.Value'].maxLength = 1;
  const changed = inspect(document, 'CreateStream'); assert.equal(changed.unavailableReason, undefined);
  const second = await approvedOperation(changed, origin); assert.notEqual(second.fingerprint, first.fingerprint); let calls = 0;
  await assert.rejects(executeCredentialed(second, flatFormValues('CreateStream'), authority.binding, authority.records, {
    assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); },
  }), error => error.code === 'PERMISSION'); assert.equal(calls, 0);
  assert.throws(() => prepareRequest(changed, flatFormValues('CreateStream')), invalid('body:Parameter99.Value'));
});
