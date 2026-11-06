// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readServiceSchema } from '../../src/lib/service-schema-packs.ts';
import { inspectServiceSchema } from '../../src/lib/service-catalog.ts';
import { credentialResultProfile, readCredentialResultContracts } from '../../src/lib/credential-results.ts';
import { approvedOperation } from '../../src/lib/secrets/policy.ts';
import { vaultVariablePlaceholder } from '../../src/lib/secrets/variables.ts';
import { VaultSession } from '../../src/lib/secrets/session.ts';
import { VaultError } from '../../src/lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from '../../src/lib/secrets/crypto.ts';
import { sealSnapshot } from '../../src/lib/secrets/format.ts';

let pending;
export function resultModels() {
  return pending ??= (async () => {
    const contracts = readCredentialResultContracts(), models = new Map(), documents = new Map();
    for (const catalog of Object.keys(contracts.sources)) {
      const document = await readServiceSchema(catalog); documents.set(catalog, document);
      const ids = new Set(Object.keys(contracts.profiles).filter(id => id.startsWith(catalog+':')));
      for (const operation of inspectServiceSchema(document, catalog, ids).operations) models.set(operation.id, operation);
    }
    return { models, documents, contracts };
  })();
}
function valueFor(schema, name) {
  if (schema.enum?.length) return schema.enum.find(value => value !== null) ?? null;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return Math.max(0, schema.minimum ?? 0);
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => valueFor(schema.items ?? { type:'string' }, name));
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map(name => [name, valueFor(schema.properties[name], name)]));
  if (schema.type === 'json') return {};
  if (name === 'order_id') return 'prodorder_'+'a'.repeat(26);
  if (name === 'media_id') return 'prodmedia_'+'b'.repeat(26);
  if (schema.pattern) {
    const candidate = ['12345678-1234-4123-8123-123456789abc','a'.repeat(32),'a'.repeat(24),'a'.repeat(20)].find(value => new RegExp(schema.pattern,'u').test(value));
    if (candidate) return candidate;
  }
  if (name.includes('url')) return 'https://webhook.synthetic.example.test/callback';
  return 'synthetic'+ 'x'.repeat(Math.max(0, (schema.minLength ?? 0)-9));
}
export async function requestFixture(operation) {
  const origin = operation.id.startsWith('github:') ? 'https://api.github.com' : 'https://api.elevenlabs.io';
  const descriptor = await approvedOperation(operation, origin), credentials = [], choices = {}, variables = [], values = {};
  const credential = (name, value = `synthetic-private-auth-${credentials.length}-538046`) => {
    const item = { id:crypto.randomUUID(), label:name, kind:'secret', value, grants:[] }; credentials.push(item); return item.id;
  };
  const alternative = operation.security?.length ? operation.security.findIndex(option => option.every(scheme => ['bearer','apiKey','basic'].includes(scheme.kind))) : 0;
  assert.ok(alternative >= 0, operation.id);
  for (const scheme of operation.security?.[alternative] ?? []) choices[scheme.name] = scheme.kind === 'basic'
    ? { username:credential('Username'), password:credential('Password') } : credential(scheme.name);
  for (const field of operation.fields.filter(field => field.required)) {
    const value = field.type === "json" && field.location !== "body" ? "synthetic" : valueFor(field.schema ?? field, field.name);
    values[field.key] = field.type === 'json' || typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  for (const key of credentialResultProfile(operation)?.privateInputs ?? []) if (operation.fields.find(field => field.key === key)?.required) {
    values[key] = vaultVariablePlaceholder; variables.push({ key, path:[], credentialId:credential('Private token input') });
  }
  if (operation.id === 'elevenlabs:create_workspace_webhook_route') values['body:settings'] = JSON.stringify({ auth_type:'hmac', name:'Synthetic webhook', webhook_url:'https://webhook.synthetic.example.test/callback' });
  return { descriptor, credentials, variables, values, binding:{ alternative, fingerprint:descriptor.fingerprint, credentials:choices } };
}
export function responseFixture(contract, secret = 'new-private-result-α\nsecret-904713') {
  const status = contract.responses[0].status, fields = contract.responses.filter(item => item.status === status), body = fields[0].path[0] === '*' ? [{}] : {};
  const values=[];
  fields.forEach((field,index) => {
    const value = `${secret}-${index}`; values.push(value);
    let parent = body;
    for (const segment of field.path.slice(0,-1)) {
      if (segment === '*') parent = parent[0];
      else { parent[segment] ??= {}; parent = parent[segment]; }
    }
    parent[field.path.at(-1)] = value;
    if (parent && !Array.isArray(parent)) parent.stable_metadata = { preserved:true, echo:value };
  });
  return { body, status, values };
}
export function noSecrets(value, secrets) {
  const encoded=JSON.stringify(value);
  for (const secret of secrets) for (const variant of [secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret),encodeURIComponent(JSON.stringify(secret).slice(1,-1))])
    assert.equal(encoded.includes(variant),false,'A private result escaped its worker');
}
export async function privateVault() {
  const key=await newVaultKey(), id=crypto.randomUUID(), methodId=crypto.randomUUID(), recovery=randomBase64(128), salt=randomBase64(16);
  const envelope={id:methodId,kind:'recovery',revision:1,salt,wrappedKey:await wrapVaultKey(key,await recoveryKey(recovery,salt),{vaultId:id,epoch:1,kind:'recovery',id:methodId,revision:1})};
  const storage={state:{revision:1,lockEpoch:1,snapshot:await sealSnapshot({id,epoch:1,revision:1,envelopes:[envelope],records:[]},key)},fail:false,afterSave:undefined,
    async read(){return structuredClone(this.state);},
    async replace(expected,snapshot,keys){if(this.fail||expected.revision!==this.state.revision||expected.lockEpoch!==this.state.lockEpoch)throw new VaultError('CONFLICT');
      this.state={revision:this.state.revision+1,lockEpoch:this.state.lockEpoch+1,snapshot:structuredClone(snapshot),keys:structuredClone(keys)};this.afterSave?.();return this.read();},
    async indexKeys(expected,keys){assert.equal(expected.revision,this.state.revision);this.state.keys=structuredClone(keys);return this.read();},
    async lock(){this.state.revision++;this.state.lockEpoch++;return this.read();}};
  const result={storage,proof:{methodId,secret:recovery},live:true,session:undefined};
  result.session=new VaultSession(storage,undefined,async()=>{if(!result.live)throw new VaultError('PERMISSION');});
  await result.session.unlock(result.proof);return result;
}
