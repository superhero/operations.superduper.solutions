// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Recover the provider's published API metadata without evaluating its JavaScript.
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
const origin = 'https://api-docs.deepseek.com';
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}
const html = await read(`${origin}/api/create-chat-completion/`);
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/js\/[^"?]+\.js)"/g)].map(match => match[1]);
const main = await read(origin + assets.find(asset => /\/main\./.test(asset)));
const runtime = await read(origin + assets.find(asset => /runtime~main\./.test(asset)));
const chunkFunction = runtime.slice(runtime.indexOf('.u='), runtime.indexOf('.miniCssF='));
const maps = [...chunkFunction.matchAll(/\{([^{}]+)\}\[e\]/g)].map(match => new Map(
  [...match[1].matchAll(/(?:^|,)([\de]+):"([^" ]+)"/g)].map(pair => [Number(pair[1]), pair[2]])));
if (maps.length !== 2) throw new Error('DeepSeek documentation chunk mapping changed; inspect before regenerating.');
const routes = [...main.matchAll(/"?([a-f\d]{8})"?:\[\(\)=>[^\n]*?,"@site\/docs\/api\/([^"/]+)\.api\.mdx",\d+\]/g)];
let document;
for (const route of routes) {
  // A non-greedy route match may begin at a preceding module: recover its last key.
  const keys = [...route[0].matchAll(/"?([a-f\d]{8})"?:\[\(\)=>/g)];
  const prefix = keys.at(-1)[1];
  const entry = [...maps[0]].find(([, name]) => name === prefix);
  if (!entry) throw new Error(`Missing documentation chunk: ${route[2]}`);
  const chunkUrl = `${origin}/assets/js/${prefix}.${maps[1].get(entry[0])}.js`;
  const chunk = await read(chunkUrl);
  const payload = chunk.match(/api:"([A-Za-z\d+/=]+)"/);
  if (!payload) throw new Error(`Missing API metadata: ${route[2]} (${chunkUrl})`);
  const api = JSON.parse(inflateSync(Buffer.from(payload[1], 'base64')));
  document ??= { openapi: '3.0.3', info: api.info, servers: api.servers, paths: {}, components: { securitySchemes: {} } };
  const { method, path, securitySchemes, servers, info, postman, jsonRequestBodyExample, ...operation } = api;
  Object.assign(document.components.securitySchemes, securitySchemes);
  operation.externalDocs = { url: `${origin}/api/${route[2]}/` };
  if (servers) operation.servers = servers;
  (document.paths[path] ??= {})[method.toLowerCase()] = operation;
  console.log(`${method.toUpperCase()} ${path}`);
}
if (!document || Object.keys(document.paths).length < 5) throw new Error('Incomplete DeepSeek API metadata.');
await mkdir('build/schema-documents', { recursive: true });
await writeFile('build/schema-documents/deepseek.json', `${JSON.stringify(document, null, 2)}\n`);
