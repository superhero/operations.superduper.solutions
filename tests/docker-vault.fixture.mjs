// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { nativeVaultFixture } from './native-vault.fixture.mjs';
import { VaultSession } from '../src/lib/secrets/session.ts';
import { VaultError } from '../src/lib/secrets/types.ts';
import { readServiceSchema } from '../src/lib/service-schema-packs.ts';
import { inspectServiceSchema } from '../src/lib/service-catalog.ts';
import { scopeOperationSchema } from '../src/lib/operation-report.ts';

export async function dockerVaultFixture(f) {
  const value = await nativeVaultFixture({ key: f.key, publicOrigin: f.host, runtime: {} });
  value.session.lock();
  const source = await readServiceSchema('docker'), operation = inspectServiceSchema(source, 'docker', new Set(['docker:ContainerList'])).operations[0];
  value.selection = { operation, document: scopeOperationSchema(source, operation.path, operation.method, true).schema };
  value.input = { label: 'Docker fixture', host: f.host, pairingKeyId: value.keyId };
  value.newSession = () => new VaultSession(value.storage, undefined, async descriptor => {
    assert.equal(descriptor.protocol, 'docker-unix'); if (!value.enabled) throw new VaultError('PERMISSION'); await value.onSchema?.(descriptor);
  }, {}, {}, {}, f.runtime);
  value.session = value.newSession(); await value.session.unlock(value.proof); return value;
}
