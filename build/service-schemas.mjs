// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { ecbRegistrationParameters, ecbRegistrationSourceSha256 } from '../src/lib/schema-patches.ts';
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
import { awsQueryActions, gmailMessageContracts, mistralVariantContracts, structuredFormContracts, formFieldContracts, multipartRootContracts, atlassianFileParts, multipartPartContracts, awsJsonTargets, betaRouteContracts, multipartFileContracts, awsRestContractsPatch, atlassianTenantServers, assetsImportSourceParameter, applySchemaPatches, privateCredentialResults, bitbucketContentParameters, trelloParameterArrays, catalogPathBindings, atlassianDcAuthentication, anthropicAuthentication, azureEventGridManagementAuth, digitalOceanBearerPermissions, elevenLabsAuthentication, geminiAuthAlternatives, githubAuthentication, googleOauthAlternatives, httpResponseStreaming, httpResponseStreamingSources, telegramPrivatePath, telegramPrivatePathSourceSha256, xOauth1Signing, xOauth1SourceSha256, cloudflarePrivateUpload, cloudflarePrivateUploadSourceSha256, providerPathBindings, atlassianServerBindings, awsS3Files, s3SourceSha256, awsWireProtocols, awsWireSources, bigqueryJobMetadata, bigqueryJobSourceSha256, googleStorageMedia, googleStorageMediaSourceSha256 } from '../src/lib/schema-patches.ts';
import { betaRouteSources } from '../src/lib/literal-query.ts';
import { multipartFileSources } from '../src/lib/multipart-file-contracts.ts';
import { multipartPartSources } from '../src/lib/multipart-part-contracts.ts';
import { gmailMessageSourceSha256 } from '../src/lib/gmail-message-contracts.ts';
import { mistralVariantSourceSha256 } from '../src/lib/mistral-variant-contracts.ts';
import { structuredFormSources } from '../src/lib/structured-form-contracts.ts';
import { formFieldSources } from '../src/lib/form-field-contracts.ts';
import { multipartRootSources } from '../src/lib/multipart-root-contracts.ts';
import { atlassianFileSources } from '../src/lib/atlassian-file-parts.ts';
import { credentialResultSources } from '../src/lib/credential-results.ts';
import { bitbucketContentSourceSha256 } from '../src/lib/parameter-content.ts';
import { trelloParameterSourceSha256 } from '../src/lib/trello-parameter-arrays.ts';
import { catalogPathBindingSources } from '../src/lib/catalog-path-bindings.ts';
import { commerceAuthentication, cloudflareLogoUpload } from '../src/lib/schema-patches.ts';
import { commerceAuthenticationSourceSha256 } from '../src/lib/atlassian-commerce-authentication.ts';
import { cloudflareLogoSourceSha256 } from '../src/lib/multipart-file-contracts.ts';
import { uploadBodySources } from '../src/lib/upload-body-contracts.ts';
import { uploadBodyContractsPatch } from '../src/lib/schema-patches.ts';
import { digitalOceanDestinations } from '../src/lib/schema-patches.ts';
import { digitalOceanDestinationSourceSha256 } from '../src/lib/digitalocean-destinations.ts';
import { atlassianDcAuthenticationSources } from '../src/lib/atlassian-dc-authentication.ts';
import { awsRestSourcePins } from '../src/lib/aws-rest-bindings.ts';
import { awsQuerySourcePins } from '../src/lib/aws-query-bindings.ts';
import { awsJsonSourcePins } from '../src/lib/aws-json-bindings.ts';
import { atlassianTenantServerSources } from '../src/lib/atlassian-tenant-servers.ts';
import { atlassianServerBindingSources } from '../src/lib/atlassian-server-bindings.ts';
import { providerPathBindingSources } from '../src/lib/provider-path-bindings.ts';
import { githubAuthenticationSourceSha256 } from '../src/lib/github-authentication-data.ts';
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
  // Bundled packs already retain the upstream IDs beside their stable IDs.
  if (!fromBundled && source.operationIds === 'method-path') document = useMethodPathOperationIds(document);
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
  if (Object.hasOwn(betaRouteSources, source.id) && sha(json) !== betaRouteSources[source.id])
    throw new Error("Beta routes require requalification before updating their pinned native source.");
  if (Object.hasOwn(atlassianFileSources, source.id) && sha(json) !== atlassianFileSources[source.id])
    throw new Error("Atlassian file uploads require requalification before updating their pinned native source.");
  if (Object.hasOwn(multipartPartSources, source.id) && sha(json) !== multipartPartSources[source.id])
    throw new Error("Multipart part contracts require requalification before updating their pinned native source.");
  if (source.id === 'google-gmail' && sha(json) !== gmailMessageSourceSha256)
    throw new Error('Gmail message media requires requalification before updating the pinned source.');
  if (source.id === 'mistral' && sha(json) !== mistralVariantSourceSha256)
    throw new Error('Mistral variants require requalification before updating their pinned source.');
  if (Object.hasOwn(structuredFormSources, source.id) && sha(json) !== structuredFormSources[source.id])
    throw new Error('Structured form encodings require requalification before updating their pinned native source.');
  if (Object.hasOwn(formFieldSources, source.id) && sha(json) !== formFieldSources[source.id])
    throw new Error('Form field codecs require requalification before updating their pinned native source.');
  if (Object.hasOwn(multipartRootSources, source.id) && sha(json) !== multipartRootSources[source.id])
    throw new Error('Multipart body roots require requalification before updating their pinned native source.');
  if (Object.hasOwn(multipartFileSources, source.id) && sha(json) !== multipartFileSources[source.id])
    throw new Error("Multipart file contracts require requalification before updating their pinned native source.");
  if (Object.hasOwn(awsJsonSourcePins, source.id) && sha(json) !== awsJsonSourcePins[source.id])
    throw new Error('AWS JSON targets require requalification before updating their pinned native source.');
  if (Object.hasOwn(awsRestSourcePins(), source.id) && sha(json) !== awsRestSourcePins()[source.id])
    throw new Error('AWS REST signing requires requalification before updating its pinned native source.');
  if (Object.hasOwn(atlassianTenantServerSources, source.id) && sha(json) !== atlassianTenantServerSources[source.id])
    throw new Error('Atlassian tenant server variables require requalification before updating the pinned native source.');
  if (Object.hasOwn(catalogPathBindingSources, source.id) && sha(json) !== catalogPathBindingSources[source.id])
    throw new Error(`${source.id}: catalog path bindings require requalification before updating the pinned native source.`);
  if (source.profile === 'atlassian-dc-authentication' && sha(json) !== atlassianDcAuthenticationSources[source.id])
    throw new Error('Atlassian Data Center authentication requires requalification before updating the pinned native source.');
  if (source.id === 'cloudflare' && sha(json) !== cloudflareLogoSourceSha256)
    throw new Error('Cloudflare logo file transport requires requalification before updating the pinned source.');
  if (source.id === 'atlassian-commerce' && sha(json) !== commerceAuthenticationSourceSha256)
    throw new Error('Commerce authentication requires requalification before updating the pinned source.');
  if (source.profile === 'github-auth' && sha(json) !== githubAuthenticationSourceSha256)
    throw new Error('GitHub authentication requires requalification before updating the pinned native source.');
  if (source.profile === 'http-streaming' && sha(json) !== httpResponseStreamingSources[source.id])
    throw new Error('HTTP streaming requires requalification before updating the pinned native source.');
  if (source.profile === 'telegram-private-path' && (source.id !== 'telegram' || sha(json) !== telegramPrivatePathSourceSha256))
    throw new Error('Telegram private paths require requalification before updating the pinned native source.');
  if (source.profile === 'x-oauth1' && (source.id !== 'x' || sha(json) !== xOauth1SourceSha256))
    throw new Error('X OAuth1 signing requires requalification before updating the pinned native source.');
  if (source.profile === 'cloudflare-upload' && (source.id !== 'cloudflare' || sha(json) !== cloudflarePrivateUploadSourceSha256))
    throw new Error('Cloudflare uploads require requalification before updating the pinned native source.');
  if (source.profile === 'provider-paths' && sha(json) !== providerPathBindingSources[source.id])
    throw new Error('Provider path bindings require requalification before updating the pinned native source.');
  if (source.profile === 'atlassian-servers' && sha(json) !== atlassianServerBindingSources[source.id])
    throw new Error('Atlassian server bindings require requalification before updating the pinned native source.');
  if (source.profile === 'aws-s3-files' && (source.id !== 'aws-s3' || sha(json) !== s3SourceSha256))
    throw new Error('S3 files require requalification before updating the pinned native source.');
  if (source.profile === 'aws-wire-protocols' && sha(json) !== awsWireSources[source.id])
    throw new Error('AWS wire protocols require requalification before updating the pinned native source.');
  if (source.id === 'gcp-bigquery' && sha(json) !== bigqueryJobSourceSha256)
    throw new Error('BigQuery job metadata requires requalification before updating the pinned native source.');
  if (source.id === 'gcp-storage' && sha(json) !== googleStorageMediaSourceSha256)
    throw new Error('Google Storage media requires requalification before updating the pinned native source.');
  if (source.id === 'ecb' && sha(json) !== ecbRegistrationSourceSha256)
    throw new Error('ECB registration parameters require requalification before updating the pinned native source.');
  if (source.id === 'trello' && sha(json) !== trelloParameterSourceSha256)
    throw new Error('Trello parameter arrays require requalification before updating the pinned native source.');
  if (source.id === 'bitbucket-dc' && sha(json) !== bitbucketContentSourceSha256)
    throw new Error('Bitbucket content parameters require requalification before updating the pinned native source.');
  if (Object.hasOwn(credentialResultSources, source.id) && sha(json) !== credentialResultSources[source.id])
    throw new Error('Private credential results require requalification before updating the pinned native source.');
  if (Object.hasOwn(uploadBodySources, source.id) && sha(json) !== uploadBodySources[source.id].sha256)
    throw new Error('Upload body contracts require requalification before updating the pinned native source.');
  const patches = source.id === 'ecb' ? [ecbRegistrationParameters]
    : source.profile === 'google-oauth' ? [googleOauthAlternatives, ...(source.id === 'gcp-bigquery' ? [bigqueryJobMetadata] : []), ...(source.id === 'gcp-storage' ? [googleStorageMedia] : [])]
    : source.profile === 'atlassian-dc-authentication' ? [atlassianDcAuthentication]
    : source.profile === 'digitalocean-permissions' ? [digitalOceanBearerPermissions]
    : source.profile === 'gemini-auth' ? [geminiAuthAlternatives]
    : source.profile === 'azure-eventgrid-auth' ? [azureEventGridManagementAuth]
    : source.profile === 'anthropic-auth' ? [anthropicAuthentication]
    : source.profile === 'elevenlabs-auth' ? [elevenLabsAuthentication]
    : source.profile === 'github-auth' ? [githubAuthentication]
    : source.profile === 'http-streaming' ? [httpResponseStreaming]
    : source.profile === 'telegram-private-path' ? [telegramPrivatePath]
    : source.profile === 'x-oauth1' ? [xOauth1Signing]
    : source.profile === 'cloudflare-upload' ? [cloudflarePrivateUpload]
    : source.profile === 'provider-paths' ? [providerPathBindings]
    : source.profile === 'atlassian-servers' ? source.id === 'jira-service-management-ops' ? [providerPathBindings, atlassianServerBindings] : [atlassianServerBindings]
    : source.profile === 'aws-s3-files' ? [awsS3Files]
    : source.profile === 'aws-wire-protocols' ? [awsWireProtocols] : [];

  if (Object.hasOwn(uploadBodySources, source.id)) patches.unshift(uploadBodyContractsPatch);
  if (source.id === 'digitalocean') {
    if (sha(json) !== digitalOceanDestinationSourceSha256) throw new Error('DigitalOcean destinations require requalification before updating their native source.');
    patches.push(digitalOceanDestinations);
  }
  if (source.id === 'cloudflare') patches.push(cloudflareLogoUpload);
  if (source.id === 'atlassian-commerce') patches.push(commerceAuthentication);
  if (Object.hasOwn(betaRouteSources, source.id)) patches.push(betaRouteContracts);
  if (Object.hasOwn(multipartFileSources, source.id)) patches.push(multipartFileContracts);
  if (Object.hasOwn(multipartPartSources, source.id)) patches.push(multipartPartContracts);
  if (Object.hasOwn(atlassianFileSources, source.id)) patches.push(atlassianFileParts);
  if (Object.hasOwn(multipartRootSources, source.id)) patches.push(multipartRootContracts);
  if (Object.hasOwn(formFieldSources, source.id)) patches.push(formFieldContracts);
  if (Object.hasOwn(structuredFormSources, source.id)) patches.push(structuredFormContracts);
  if (source.id === 'mistral') patches.push(mistralVariantContracts);
  if (source.id === 'google-gmail') patches.push(gmailMessageContracts);
  if (Object.hasOwn(awsRestSourcePins(), source.id)) patches.push(awsRestContractsPatch);
  if (Object.hasOwn(awsJsonSourcePins, source.id)) patches.push(awsJsonTargets);
  if (Object.hasOwn(awsQuerySourcePins, source.id)) patches.push(awsQueryActions);
  if (Object.hasOwn(atlassianTenantServerSources, source.id)) patches.push(atlassianTenantServers);
  if (Object.hasOwn(catalogPathBindingSources, source.id)) patches.push(catalogPathBindings);
  if (source.id === 'bitbucket-dc') patches.push(bitbucketContentParameters);
  if (source.id === 'trello') patches.push(trelloParameterArrays);
  if (source.id === 'atlassian-assets') patches.push(assetsImportSourceParameter);
  if (Object.hasOwn(credentialResultSources, source.id)) patches.push(privateCredentialResults);
  if (Object.hasOwn(awsQuerySourcePins, source.id) && sha(json) !== awsQuerySourcePins[source.id])
    throw new Error(`${source.id}: AWS Query native source changed; review its pin before enabling the adapter.`);
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
