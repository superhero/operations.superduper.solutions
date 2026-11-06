// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { awsRestEndpoint, awsRestPrivateInputKeys } from './aws-rest.ts';
import { awsJsonEndpoint, awsJsonPrivateInputKeys } from './aws-json.ts';
import { awsJsonPrivateProfile } from './aws-json-private.ts';
import { awsQueryPrivateProfile } from './aws-query-private.ts';
import { awsQueryEndpoint, awsQueryPrivateInputKeys } from './aws-query.ts';
import data from './credential-results.json' with { type: 'json' };
import type { Operation } from './catalog.ts';
import { connectJwtOriginAllowed } from './atlassian-relative-servers.ts';

type Value = Record<string, any>;
export type PrivateResultResponse = { status: number; path: string[]; required: boolean[]; nullable: boolean[]; parentFields: (string[] | null)[]; leaf: Value };
export type PrivateResultContract = { catalog: string; method: string; path: string; responses: PrivateResultResponse[];
  privateInputs: string[]; masked: boolean; exampleOnly: boolean; awsJson?: { id: string; revision: string }; awsQuery?: { id: string; revision: string }; digitalOceanUpload?: true };
const contracts = structuredClone(data) as { version: number; sources: Record<string, { title: string; version: string; openapi: string; origins: string[]; sha256: string }>;
  profiles: Record<string, PrivateResultContract> };
export const privateResultVersion = 'private-result-v1';
export const credentialResultSources = Object.fromEntries(Object.entries(contracts.sources).map(([id, source]) => [id, source.sha256]));
export const readCredentialResultContracts = () => structuredClone(contracts);

/** A marker cannot authorize an unreviewed method or a streaming response. */
export function credentialResultProfile(operation: Operation): PrivateResultContract | undefined {
  if (operation.credentialResultProfile === undefined) return;
  const contract = contracts.profiles[operation.id] ?? awsJsonPrivateProfile(operation) ?? awsQueryPrivateProfile(operation);
  if (operation.credentialResultProfile !== privateResultVersion || operation.credentialResult !== true || !contract
    || operation.method !== contract.method || operation.path !== contract.path || operation.responseStream !== undefined)
    throw new Error('This operation does not match a reviewed private credential-result contract.');
  return structuredClone(contract);
}
export function supportsCredentialResults(operation: Operation): boolean {
  try { return !!credentialResultProfile(operation); } catch { return false; }
}
export function privateResultInputKeys(operation: Operation): string[] {
  return [...new Set([...(credentialResultProfile(operation)?.privateInputs ?? []), ...awsRestPrivateInputKeys(operation),
    ...(operation.awsJson ? awsJsonPrivateInputKeys(operation) : []), ...(operation.awsQuery ? awsQueryPrivateInputKeys(operation) : [])])];
}
export function privateResultOriginAllowed(operation: Operation, origin: string): boolean {
  const profile = credentialResultProfile(operation); if (!profile) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
    if (profile.catalog.startsWith('aws-')) return operation.awsQuery ? !!awsQueryEndpoint(origin, operation) : operation.awsJson ? !!awsJsonEndpoint(origin, operation) : !!awsRestEndpoint(origin, operation);
    if (profile.catalog === 'atlassian-assets') return url.origin === 'https://api.atlassian.com'
      && /^\/ex\/jira\/[A-Za-z0-9-]+\/jsm\/assets\/workspace\/[A-Za-z0-9-]+\/v1\/?$/.test(url.pathname);
    if (profile.catalog === 'atlassian-app-migration') return connectJwtOriginAllowed(operation, origin);
    return contracts.sources[profile.catalog]!.origins.some(value => new URL(value).href === url.href);
  } catch { return false; }
}
const referenceSchema = () => ({ anyOf: [{ type: 'object', required: ['credentialId', 'label'], additionalProperties: false,
  properties: { credentialId: { type: 'string', format: 'uuid' }, label: { type: 'string' } },
  description: 'Reference to a value saved in Secrets. The credential itself stays in the vault.' }, { type: 'null' }] });
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);
function requireContract(valid: unknown): asserts valid {
  if (!valid) throw new Error('Private credential results require the reviewed source response contract.');
}
function resolve(input: unknown, document: Value): Value {
  requireContract(object(input)); let node = input; const seen = new Set<string>();
  while (node.$ref !== undefined) {
    const ref = node.$ref;
    requireContract(typeof ref === 'string' && ref.startsWith('#/') && !seen.has(ref) && seen.size < 16); seen.add(ref);
    let target: unknown = document;
    for (const segment of ref.slice(2).split('/')) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      requireContract(object(target) && Object.hasOwn(target, key)); target = target[key];
    }
    requireContract(object(target)); const { $ref: _ref, ...siblings } = node; node = { ...target, ...siblings };
  }
  return node;
}
function project(input: Value, response: PrivateResultResponse, document: Value, depth = 0): Value {
  const node = resolve(input, document);
  if (depth === response.path.length) {
    requireContract(JSON.stringify(node) === JSON.stringify(response.leaf));
    return referenceSchema();
  }
  const union = Array.isArray(node.anyOf) ? 'anyOf' : Array.isArray(node.oneOf) ? 'oneOf' : undefined;
  if (union) {
    const variants = node[union] as Value[];
    requireContract(variants.length === 2 && variants.filter(part => part.type === 'null').length === 1);
    return { ...node, [union]: variants.map(part => part.type === 'null' ? part : project(part, response, document, depth)) };
  }
  const segment = response.path[depth]!;
  if (Array.isArray(node.allOf)) {
    const matching = node.allOf.flatMap((part: Value, index: number) => {
      const candidate = resolve(part, document);
      return (segment === '*' ? candidate.type === 'array' && object(candidate.items)
        : Object.hasOwn(candidate.properties ?? {}, segment)) ? [index] : [];
    });
    requireContract(matching.length === 1);
    return { ...node, allOf: node.allOf.map((part: Value, index: number) => matching[0] === index ? project(part, response, document, depth) : part) };
  }
  if (segment === '*') { requireContract(node.type === 'array' && object(node.items)); return { ...node, items: project(node.items, response, document, depth + 1) }; }
  requireContract(object(node.properties) && Object.hasOwn(node.properties, segment));
  return { ...node, properties: { ...node.properties, [segment]: project(node.properties[segment], response, document, depth + 1) } };
}

/** Project only reviewed secret leaves; keep metadata and the complete upstream
 * response declarations separately, without mutating shared schema components. */
export function bindCredentialResults(document: Value): void {
  const matches = Object.entries(contracts.sources).filter(([, source]) => document.info?.title === source.title
    && document.info?.version === source.version && document.openapi === source.openapi);
  requireContract(matches.length === 1); const catalog = matches[0]![0];
  for (const [id, contract] of Object.entries(contracts.profiles).filter(([, profile]) => profile.catalog === catalog)) {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(object(operation) && `${catalog}:${operation.operationId}` === id
      && operation['x-upstream-private-result-responses'] === undefined && operation['x-operations-private-result'] === undefined
      && (contract.exampleOnly || operation['x-operations-credential-result'] === true));
    const responses = structuredClone(operation.responses);
    requireContract(object(responses));
    for (const response of contract.responses) {
      const media = responses[String(response.status)]?.content?.['application/json']; requireContract(object(media));
      let schema = media.schema;
      if (contract.exampleOnly) {
        requireContract(schema === undefined && object(media.example) && Object.keys(media.example).length === 1 && typeof media.example.token === 'string');
        schema = { type: 'object', required: ['token'], properties: { token: { type: 'string' } } };
      }
      media.schema = project(schema, response, document); delete media.example; delete media.examples;
      if (contract.digitalOceanUpload) media.schema.properties.upload_origin = { type: "string", format: "uri", readOnly: true,
        description: "Public storage origin for the upload connection. The signed path and query remain private in Secrets." };
    }
    operation['x-upstream-private-result-responses'] = operation.responses;
    operation.responses = responses; operation['x-operations-credential-result'] = true;
    operation['x-operations-private-result'] = privateResultVersion;
  }
}
