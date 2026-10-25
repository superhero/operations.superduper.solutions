// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { inspectServiceSchema } from '../src/lib/service-catalog.ts';
import { createSchemaDiscovery } from '../src/lib/schema-index.ts';
import { applySchemaPatches } from '../src/lib/schema-patches.ts';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'src/catalogs/services');
const output = resolve(directory, 'indexes');
const check = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const adapter = createHash('sha256');
for (const file of ['catalog.ts', 'service-catalog.ts', 'form-input.ts', 'cloudflare-upload.ts', 'codex-schema.ts', 'native-rpc.ts', 'docker-native-model.ts', 'docker-native-contract.ts', 'native-agent-contract.ts', 'native-runtime-contract.ts', 'operation-security.ts', 'operation-capabilities.ts', 'schema-documents.ts', 'schema-index.ts', 'server-url.ts', 'workflow-binary.ts', 'workflow-response-body.ts', 'workflow-response-stream.ts', 'workflow-body-error.ts', 'schema-patches.ts', 'github-authentication.ts', 'github-authentication-data.ts'])
  adapter.update(file).update(await readFile(resolve(root, 'src/lib', file)));
const adapterRevision = adapter.digest('hex');
if (!check) await mkdir(output, { recursive: true });
async function artifact(filename, bytes) {
  if (check) {
    let saved;
    try { saved = await readFile(filename); } catch { /* Report one actionable freshness error. */ }
    if (!saved?.equals(bytes)) throw new Error(`Schema discovery artifact is outdated: ${filename}. Run npm run schemas:index.`);
  } else await writeFile(filename, bytes);
}
const sources = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'));
const indexes = [];
for (const source of sources) {
  const bytes = gunzipSync(await readFile(resolve(directory, `${source.id}.json.gz`)));
  if (bytes.length !== source.bytes || hash(bytes) !== source.sha256) throw new Error(`Bundled schema integrity failed: ${source.id}`);
  const document = applySchemaPatches(JSON.parse(bytes), source.patches);
  const sourceRevision = source.effectiveSha256 ?? source.sha256;
  if (source.effectiveSha256 && hash(JSON.stringify(document)) !== source.effectiveSha256)
    throw new Error(`Corrected schema integrity failed: ${source.id}`);
  const discovery = createSchemaDiscovery(inspectServiceSchema(document, source.id), sourceRevision);
  if (discovery.operations.length !== source.operations) throw new Error(`Operation inventory changed: ${source.id}`);
  const serialized = Buffer.from(JSON.stringify(discovery));
  const compressed = gzipSync(serialized, { level: 9 });
  await artifact(resolve(output, `${source.id}.json.gz`), compressed);
  indexes.push({ id: source.id, sourceRevision, bytes: serialized.length, compressedBytes: compressed.length,
    sha256: hash(serialized), summary: discovery.summary });
}
await artifact(resolve(output, 'index.json'), Buffer.from(JSON.stringify({ adapterRevision, indexes }, null, 2) + '\n'));
console.log(`Schema discovery indexes ${check ? 'verified' : 'generated'}: ${indexes.length}.`);
