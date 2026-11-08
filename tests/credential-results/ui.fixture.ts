// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-only browser entry; never installed in the production application.
import { mount, unmount } from 'svelte';
import UiHarness from './UiHarness.svelte';
import { loadSchemaLibrary, hydrateOperation } from '../../src/lib/schema-library.ts';
import { approvedOperation } from '../../src/lib/secrets/policy.ts';
import { workflowExecutionForOperation } from '../../src/lib/workflow-execution.ts';
import type { Operation } from '../../src/lib/catalog.ts';
import { vaultCall, lockVaultLocally } from '../../src/lib/secrets/client.ts';
import type { CredentialBinding } from '../../src/lib/secrets/types.ts';
let binding: CredentialBinding | undefined, recovery = '', methodId = '';
let operationModel: Operation;
let harness: ReturnType<typeof mount>;
export async function initialize() {
  await loadSchemaLibrary();
  const model = await hydrateOperation('elevenlabs:public_get_media_info');
  const operation = await hydrateOperation('github:apps/check-token');
  operationModel = model;
  recovery = await vaultCall('prepareCreate', ['Private-result-browser-fixture-54820']) as string;
  const status = await vaultCall('confirmCreate', [recovery]) as { methods:{id:string;kind:string}[] };
  methodId = status.methods.find(method => method.kind === 'recovery')!.id;
  harness = mount(UiHarness,{target:documentElement('private-result-controls'),props:{operation:model,privateInputOperation:operation,onChange:(value:CredentialBinding|undefined)=>{binding=value;}}});
}
function documentElement(id:string) { const element = globalThis.document.createElement('div'); element.id=id; globalThis.document.body.append(element); return element; }
export const currentBinding = () => binding ?? null;
export const lock = () => lockVaultLocally();
export async function unlock() { await vaultCall('unlock',[{methodId,secret:recovery}]); }
export async function cleanup() { await unmount(harness); lockVaultLocally(); binding=undefined; recovery=''; }

export async function acquire() {
  if (!binding) throw new Error('No unlocked private binding');
  const descriptor = await approvedOperation(operationModel, workflowExecutionForOperation(operationModel).origin);
  const values = {'path:order_id':'prodorder_'+'a'.repeat(26),'path:media_id':'prodmedia_'+'b'.repeat(26)};
  const result = await vaultCall('execute',[descriptor,values,binding]) as {response:{body:{signed_url:{credentialId:string;label:string};content_type:string}}};
  const reference = result.response.body.signed_url;
  if (!reference.credentialId || !reference.label || result.response.body.content_type !== 'audio/mpeg') throw new Error('Private result reference missing');
  const keys = await vaultCall('keys',[]), summaries = await vaultCall('list',[]), backup = await vaultCall('backup',[]);
  const secret = 'https://signed.example.test/private-browser-result-724190';
  if (JSON.stringify({result,keys,summaries,backup}).includes(secret)) throw new Error('Private result crossed a public boundary');
  // Explicit user-copy action is the separate, existing disclosure path.
  if (await vaultCall('copyCredential',[reference.credentialId]) !== secret) throw new Error('Acquired credential did not persist');
  return {workerAdoption:true,opaqueReference:true,publicValuesRedacted:true,encryptedBackup:true,explicitCopyMatches:true};
}
