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
import { nativeMethodSourceSha256, validateNativeMethodResults } from '../src/lib/native-method-results.ts';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'src/catalogs/services');
const output = resolve(directory, 'indexes');
const check = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const adapter = createHash('sha256');
for (const file of ['gmail-message.ts', 'gmail-message-contracts.ts', 'gmail-message-contracts.json', 'mistral-variant.ts', 'mistral-variant-contracts.ts', 'mistral-variant-contracts.json', 'gitlab-form.ts', 'structured-form-contracts.ts', 'structured-form-contracts.json', 'form-field-contracts.ts', 'form-field-contracts.json', 'multipart-root-contracts.ts', 'multipart-root-contracts.json', 'atlassian-file-parts.ts', 'atlassian-file-parts.json', 'multipart-parts.ts', 'multipart-part-contracts.ts', 'multipart-part-contracts.json', 'aws-json.ts', 'aws-json-data.ts', 'aws-json-pins.json', 'aws-json-private-policy.json', 'aws-json-private.ts', 'aws-json-bindings.ts', 'literal-query.ts', 'multipart-file-contracts.ts', 'aws-rest.ts', 'aws-rest-data.ts', 'aws-rest-bindings.ts', 'aws-rest-codec.ts', 'atlassian-tenant-servers.ts', 'assets-import-source.ts', 'docker-http.ts', 'docker-http-contracts.json', 'atlassian-relative-servers.ts', 'atlassian-relative-contracts.json', 'multipart-parts.ts', 'digitalocean-destinations.ts', 'digitalocean-destinations.json', 'openai-chat-stream.ts', 'credential-results.ts', 'credential-results.json', 'parameter-content.ts', 'trello-parameter-arrays.ts', 'catalog-path-bindings.ts', 'catalog-path-bindings.json', 'request-media.ts', 'atlassian-dc-authentication.ts', 'schema-pack-codec.ts', 'operation-display.ts', 'operation-display.json', 'catalog.ts', 'atlassian-server-bindings.ts', 'provider-path-bindings.ts', 'service-catalog.ts', 'query-serialization.ts', 'parameter-serialization.ts', 'form-input.ts', 'aws-signing.ts', 'aws-wire.ts', 'aws-wire-response.ts', 's3-files.ts', 'cloudflare-upload.ts', 'codex-schema.ts', 'native-rpc.ts', 'native-method-results.ts', 'native-method-results-data.ts', 'native-method-results.json', 'docker-native-model.ts', 'docker-native-contract.ts', 'native-agent-contract.ts', 'native-command.ts', 'native-thread-shell.ts', 'native-migration.ts', 'native-stored-thread.ts', 'native-thread-lifecycle.ts', 'native-thread-content.ts', 'native-configuration-read.ts', 'native-configuration-control.ts', 'native-configuration-write.ts', 'native-account.ts', 'native-account-read.ts', 'native-account-auth.ts', 'native-gateway-oauth.ts', 'native-account-actions.ts', 'native-turn-control.ts', 'native-initialize.ts', 'native-query-contract.ts', 'native-section-contract.ts', 'native-mcp-read.ts', 'native-mcp-tool.ts', 'native-mcp-oauth.ts', 'native-filesystem-read.ts', 'native-filesystem-write.ts', 'native-filesystem-watch.ts', 'native-feedback-contract.ts', 'secrets/native-query-result.ts', 'secrets/native-credentials.ts', 'native-runtime-contract.ts', 'operation-security.ts', 'operation-capabilities.ts', 'schema-documents.ts', 'schema-index.ts', 'server-url.ts', 'workflow-binary.ts', 'workflow-response-body.ts', 'workflow-response-stream.ts', 'workflow-body-error.ts', 'schema-patches.ts', 'github-authentication.ts', 'github-authentication-data.ts'])
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
  if (source.id === 'codex') {
    if (source.sha256 !== nativeMethodSourceSha256) throw new Error('Native method schemas require new source qualification.');
    validateNativeMethodResults(document);
  }
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
