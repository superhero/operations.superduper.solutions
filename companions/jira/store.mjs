// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/** One companion process owns this directory. All writes commit encrypted bytes
 * atomically before publishing their in-memory version; no plaintext fallback. */
export async function openJiraStore(directory, encodedKey, hostId) {
  if (!directory || resolve(directory) !== directory || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)
    || Buffer.from(encodedKey, 'base64url').length !== 32 || !/^[a-f0-9-]{36}$/i.test(hostId)) throw new Error('Invalid companion storage configuration.');
  const key = Buffer.from(encodedKey, 'base64url'), aad = Buffer.from('operations-jira-store-v1:' + hostId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'connections.aes-gcm.json');
  let records = [], queue = Promise.resolve();
  try {
    const bytes = await readFile(filename); if (bytes.length > 4 * 1024 * 1024) throw new Error();
    const envelope = JSON.parse(bytes);
    if (envelope.version !== 1 || Object.keys(envelope).sort().join(',') !== 'data,iv,tag,version') throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    records = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(records) || records.length > 128 || new Set(records.map(record => record.id)).size !== records.length) throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('The encrypted companion store could not be opened.');
  }
  async function persist(next) {
    if (next.length > 128) throw new Error('The companion connection limit was reached.');
    const plaintext = Buffer.from(JSON.stringify(next)); if (plaintext.length > 2 * 1024 * 1024) throw new Error('The companion store is full.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]); plaintext.fill(0);
    const bytes = JSON.stringify({ version: 1, iv: iv.toString('base64'), data: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
    const temporary = join(directory, '.connections-' + randomBytes(16).toString('hex'));
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, filename);
    const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
    records = next;
  }
  const mutate = action => {
    const operation = queue.then(async () => { const next = action(structuredClone(records)); await persist(next); });
    queue = operation.catch(() => {}); return operation;
  };
  return {
    async list() { await queue; return structuredClone(records); },
    async get(id) { await queue; return structuredClone(records.find(record => record.id === id)); },
    put(record) { return mutate(current => [...current.filter(item => item.id !== record.id), structuredClone(record)]); },
    remove(id) { return mutate(current => current.filter(item => item.id !== id)); },
    async close() { await queue; key.fill(0); },
  };
}

/** Test/runtime adapter with the same serialized snapshot contract. */
export function memoryJiraStore() {
  const records = new Map();
  return { async list() { return [...records.values()].map(value => structuredClone(value)); },
    async get(id) { return structuredClone(records.get(id)); },
    async put(value) { records.set(value.id, structuredClone(value)); },
    async remove(id) { records.delete(id); }, async close() {} };
}
