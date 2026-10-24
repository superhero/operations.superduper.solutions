// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import RefParser from '@apidevtools/json-schema-ref-parser';
import { parse } from 'yaml';
import converter from 'swagger2openapi';
import { bundleSwaggerReferences } from './swagger-references.mjs';
import { adaptFredSchema } from './fred-schema.mjs';
import { extractRedocSchema } from './redoc-schema.mjs';
import { useMethodPathOperationIds } from './service-operation-identities.mjs';
import { applySchemaPatches, digitalOceanBearerPermissions, geminiAuthAlternatives, googleOauthAlternatives } from '../src/lib/schema-patches.ts';
import { annotateCodexSchema } from './codex-schema.mjs';
import { inspectCodexSchema } from '../src/lib/codex-schema.ts';

const root = resolve(import.meta.dirname, '..');
const cache = resolve(root, 'tmp/schema-sources');
const output = resolve(root, 'src/catalogs/services');
const sha = data => createHash('sha256').update(data).digest('hex');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const sources = JSON.parse(await readFile(resolve(root, 'build/service-schemas.sources.json'), 'utf8'));
const arguments_ = process.argv.slice(2);
const fromBundled = arguments_.includes('--from-bundled');
const profile = arguments_.find(value => value.startsWith('--profile='))?.slice('--profile='.length);
const selected = arguments_.filter(value => !value.startsWith('--'));
const indexPath = resolve(output, 'index.json');
let index;
try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { index = []; }
let running = 0;
const waiting = [];
async function download(url, allowHtml = false) {
  if (!url.startsWith('https://')) throw new Error(`Schema references must use HTTPS: ${url}`);
  const filename = resolve(cache, sha(url));
  try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (running >= 2) await new Promise(resolve => waiting.push(resolve));
  running++;
  try {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        const text = await response.text();
        if (Buffer.byteLength(text) > 50 * 1024 * 1024) throw new Error(`Schema source exceeds 50 MiB: ${url}`);
        if (!allowHtml && /^\s*(?:<!doctype|<html)/i.test(text)) throw new Error(`Expected a schema but received HTML: ${url}`);
        await writeFile(filename, text);
        return text;
      } catch (error) { failure = error; }
    }
    throw failure;
  } finally { running--; waiting.shift()?.(); }
}
const resolver = { order: 1, canRead: /^https:\/\//i, read: file => download(file.url) };
for (const source of sources) {
  if (selected.length && !selected.includes(source.id)) continue;
  if (profile && source.profile !== profile) continue;
  const previous = index.find(entry => entry.id === source.id);
  const text = fromBundled ? gunzipSync(await readFile(resolve(output, `${source.id}.json.gz`))).toString('utf8')
    : source.file ? await readFile(resolve(root, source.file), 'utf8') : await download(source.url, source.conversion === 'redoc');
  if (fromBundled && (sha(text) !== previous?.sha256 || Buffer.byteLength(text) !== previous?.bytes))
    throw new Error(`${source.id}: existing pack integrity failed.`);
  let document = fromBundled ? JSON.parse(text) : source.conversion === 'redoc' ? extractRedocSchema(text) : parse(text);
  if (fromBundled && source.profile === 'google-oauth' && !previous.patches) {
    // One-time migration of the earlier in-place Google adaptation. Its saved
    // provenance must exactly explain the previous correction before restoring it.
    function restore(target) {
      if (!target || !Object.hasOwn(target, 'x-upstream-security')) return;
      const original = target['x-upstream-security'];
      const legacy = original.map(requirement => {
        if (!Object.hasOwn(requirement, 'Oauth2') || !Object.hasOwn(requirement, 'Oauth2c')) return requirement;
        const { Oauth2: _implicit, ...rest } = requirement;
        return rest;
      });
      if (JSON.stringify(legacy) !== JSON.stringify(target.security)) throw new Error(`${source.id}: ambiguous legacy Google correction.`);
      target.security = original;
      delete target['x-upstream-security'];
    }
    restore(document);
    for (const item of Object.values(document.paths ?? {}))
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) restore(item?.[method]);
  }
  if (!fromBundled && source.conversion === 'swagger2') {
    document = await bundleSwaggerReferences(document, source.url, download);
    document = (await converter.convertObj(document, { patch: true, warnOnly: false })).openapi;
  }
  // Bundle rather than dereference: recursive models remain finite JSON.
  if (!fromBundled && source.format === 'codex-app-server') document = annotateCodexSchema(document, source);
  else if (!fromBundled) document = await RefParser.bundle(source.url ?? resolve(root, source.file), document,
    { resolve: { file: false, http: resolver } });
  if (source.profile === 'fred' || source.profile === 'alfred') document = adaptFredSchema(document, source.profile);
  if (source.operationIds === 'method-path') document = useMethodPathOperationIds(document);
  if ((typeof document.info?.version !== 'string' || !document.info.version) && source.version) document.info.version = source.version;
  if (typeof document.info?.version !== 'string' || !document.info.version) throw new Error(`${source.id}: missing schema version; specify a documented source snapshot version.`);
  if (source.format !== 'codex-app-server' && (!/^3\.(0|1)\./.test(document?.openapi) || !document.info || !document.paths))
    throw new Error(`${source.id}: expected an OpenAPI 3.0/3.1 document with info and paths.`);
  if (source.origin) document.servers = [{ url: source.origin }];
  if (source.routing === 'bluesky') {
    const servers = document.servers;
    const publicServer = servers.find(server => server.url === 'https://public.api.bsky.app');
    const pds = servers.find(server => server.variables?.host);
    const relay = servers.find(server => server.url === 'https://bsky.network');
    for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method) || operation.servers || item.servers) continue;
      const security = operation.security ?? document.security;
      const authenticated = security?.length && security.every(alternative => Object.keys(alternative).length);
      const server = path.startsWith('/xrpc/com.atproto.sync.') ? relay
        : path.startsWith('/xrpc/app.bsky.') && method === 'get' && !authenticated ? publicServer : pds;
      if (!server) throw new Error(`${source.id}: missing documented service route for ${path}`);
      operation.servers = [server];
    }
  }
  const json = JSON.stringify(document);
  const patches = source.profile === 'google-oauth' ? [googleOauthAlternatives]
    : source.profile === 'digitalocean-permissions' ? [digitalOceanBearerPermissions]
    : source.profile === 'gemini-auth' ? [geminiAuthAlternatives] : [];
  const effective = patches.length ? JSON.stringify(applySchemaPatches(document, patches)) : json;
  const bytes = gzipSync(json, { level: 9 });
  await writeFile(resolve(output, `${source.id}.json.gz`), bytes);
  const operations = source.format === 'codex-app-server' ? inspectCodexSchema(document, source.id).operations.length : Object.values(document.paths).reduce((count, path) => count +
    Object.keys(path).filter(method => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)).length, 0);
  const entry = { ...source, version: document.info.version, openapi: document.openapi,
    ...(source.format === 'codex-app-server' ? { protocol: 'json-rpc' } : {}), operations,
    license: document.info.license ?? null, sha256: sha(json),
    sourceSha256: fromBundled ? previous.sourceSha256 : sha(text), bytes: Buffer.byteLength(json), compressedBytes: bytes.length,
    ...(patches.length ? { patches, effectiveSha256: sha(effective), effectiveBytes: Buffer.byteLength(effective) } : {}) };
  index = [...index.filter(item => item.id !== source.id), entry].sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${source.id}: ${operations} operations, ${bytes.length} compressed bytes`);
}
