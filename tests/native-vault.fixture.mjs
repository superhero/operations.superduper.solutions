// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readServiceSchema } from '../src/lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from '../src/lib/native-rpc.ts';
import { VaultSession } from '../src/lib/secrets/session.ts';
import { VaultError } from '../src/lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from '../src/lib/secrets/crypto.ts';
import { sealSnapshot } from '../src/lib/secrets/format.ts';
import { nativeAgentMethods } from '../src/lib/native-agent-contract.ts';

export async function nativeVaultFixture(f) {
  const key = await newVaultKey(), id = randomUUID(), methodId = randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: 'recovery', revision: 1, salt, wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery, salt),
    { vaultId: id, epoch: 1, kind: 'recovery', id: methodId, revision: 1 }) };
  const storage = { state: { revision: 1, lockEpoch: 1, snapshot: await sealSnapshot({ id, epoch: 1, revision: 1, envelopes: [envelope], records: [] }, key) },
    async read() { return structuredClone(this.state); },
    async replace(expected, snapshot, keys) {
      if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError('CONFLICT');
      this.state = { revision: this.state.revision + 1, lockEpoch: this.state.lockEpoch + 1, snapshot: structuredClone(snapshot), keys: structuredClone(keys) }; return this.read();
    }, async indexKeys(expected, keys) { assert.equal(expected.revision, this.state.revision); this.state.keys = structuredClone(keys); return this.read(); },
    async lock() { this.state.revision++; this.state.lockEpoch++; return this.read(); } };
  const v = { storage, enabled: true, proof: { methodId, secret: recovery } };
  const document = scopeNativeRpcSchema(await readServiceSchema('codex'), 'account/read');
  v.selection = { operation: nativeRpcOperation(document, 'codex:account/read'), document };
  v.newSession = () => new VaultSession(storage, undefined, async descriptor => {
    assert.equal(descriptor.operation.protocol, 'json-rpc'); if (!v.enabled) throw new VaultError('PERMISSION');
    await v.onSchema?.(descriptor);
  }, {}, {}, f.runtime);
  v.session = v.newSession(); await v.session.unlock(v.proof);
  const entries = await v.session.put(null, { label: 'Native pairing key', kind: 'secret', value: f.key });
  v.keyId = entries.find(entry => entry.label === 'Native pairing key').id;
  v.input = { label: 'Codex fixture', host: f.publicOrigin, pairingKeyId: v.keyId };
  v.workflowSelections = async () => {
    const source = await readServiceSchema('codex');
    return nativeAgentMethods.map(method => { const document = scopeNativeRpcSchema(source, method); return { operation: nativeRpcOperation(document, 'codex:' + method), document }; });
  };
  return v;
}
