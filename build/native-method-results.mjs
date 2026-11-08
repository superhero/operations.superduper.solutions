// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') options.check = true;
  else if (['--source', '--output'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i];
  else throw new Error('Use --source <pinned common.rs> [--output <file>] [--check].');
}
if (!options.source) throw new Error('The pinned protocol source is required.');
const hash = value => createHash('sha256').update(value).digest('hex');
const source = await readFile(options.source);
const pin = { version: '0.163.0', commit: '83086188ae0614bd882818ff1aa23f3194962012',
  path: 'codex-rs/app-server-protocol/src/protocol/common.rs',
  sha256: 'ee03e7b76763ac658f4af3d36c0c1a26c00dff6ee9256d474dd85fa740143cc3' };
if (hash(source) !== pin.sha256) throw new Error('The native method declarations do not match their reviewed source.');
const text = source.toString('utf8'), start = text.indexOf('client_request_definitions! {');
if (start < 0) throw new Error('The native client request declarations are unavailable.');
const block = text.slice(start, text.indexOf('\n}', start) + 2), declarations = new Map();
for (const match of block.matchAll(/^\s*(\w+)\s*=>\s*"([^"]+)"\s*\{(.*?)^\s*\},/gms)) {
  const response = /^\s*response:\s*([^,\n]+)/m.exec(match[3]);
  if (!response || declarations.has(match[2])) throw new Error('Ambiguous native response declaration.');
  declarations.set(match[2], response[1].trim());
}
const bytes = gunzipSync(await readFile(resolve(root, 'src/catalogs/services/codex.json.gz'))), document = JSON.parse(bytes);
if (document.info.version !== pin.version) throw new Error('Native schema version needs new method qualification.');
const results = {};
for (const request of document.definitions.ClientRequest.oneOf) {
  const method = request.properties.method.enum[0], response = declarations.get(method);
  if (!response || !/^(?:(?:v1|v2)::)?[A-Za-z][A-Za-z0-9]*$/.test(response) || Object.hasOwn(results, method))
    throw new Error('The native method has no unambiguous declared response: ' + method);
  const parts = response.split('::'), name = parts.at(-1), ref = '#/definitions/' + (parts[0] === 'v2' ? 'v2/' : '') + name;
  let target = document;
  for (const key of ref.slice(2).split('/')) target = target && Object.hasOwn(target, key) ? target[key] : undefined;
  if (target === undefined) throw new Error('The bundled native response schema is missing: ' + method);
  results[method] = ref;
}
if (Object.keys(results).length !== 105) throw new Error('The native method inventory needs new qualification.');
const output = Buffer.from(JSON.stringify({ source: { ...pin,
  url: 'https://raw.githubusercontent.com/openai/codex/' + pin.commit + '/' + pin.path,
  schemaSha256: hash(bytes), schemaBytes: bytes.length }, results }, null, 2) + '\n');
const filename = resolve(options.output ?? resolve(root, 'src/lib/native-method-results.json'));
// Keep the reviewed JSON. Compact only exact conventional names; every differing
// declaration is encoded explicitly, then all 105 references are roundtrip checked.
const conventional = method => 'v2/' + method.split('/').map(part => part[0].toUpperCase() + part.slice(1)).join('');
const rows = Object.entries(results).map(([method, ref]) => {
  if (/[|=]/.test(method) || !/^#\/definitions\/(?:v2\/)?[A-Za-z][A-Za-z0-9]*Response$/.test(ref)) throw new Error('Native result packing requires qualification.');
  const path = ref.slice('#/definitions/'.length, -'Response'.length);
  return method + (path === conventional(method) ? '' : '=' + path);
}).join('|');
const restored = Object.fromEntries(rows.split('|').map(row => {
  const [method, path] = row.split('='); return [method, '#/definitions/' + (path ?? conventional(method)) + 'Response'];
}));
if (JSON.stringify(restored) !== JSON.stringify(results)) throw new Error('Native result packing changed declarations.');
const runtimeFilename = filename.replace(/\.json$/, '-data.ts');
if (runtimeFilename === filename) throw new Error('Native result output must be a JSON path.');
const runtimeOutput = Buffer.from(`// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Generated from reviewed declarations; explicit names override the mechanical default.
const rows = ${JSON.stringify(rows)};
export function decodeNativeMethodResultsData(): { source: { version: string; schemaSha256: string }; results: Record<string, string> } {
  const results = Object.fromEntries(rows.split('|').map(row => {
    const [method, path] = row.split('=');
    return [method!, '#/definitions/' + (path ?? 'v2/' + method!.split('/').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')) + 'Response'];
  }));
  return { source: ${JSON.stringify({version: pin.version, schemaSha256: hash(bytes)})}, results };
}
`);
if (options.check) {
  if (!(await readFile(filename)).equals(output) || !(await readFile(runtimeFilename)).equals(runtimeOutput)) throw new Error('Native method result declarations are outdated.');
} else { await writeFile(filename, output); await writeFile(runtimeFilename, runtimeOutput); }
console.log('Native method result declarations ' + (options.check ? 'verified' : 'generated') + ': ' + Object.keys(results).length);
