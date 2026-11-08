// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from './catalog.ts';
export const githubArchiveProfile = 'github-migration-archive-v1';
export const githubArchiveLimit = 500_000;
export const githubArchiveContracts = [
  { id: 'github:migrations/get-archive-for-authenticated-user', path: '/user/migrations/{migration_id}/archive',
    parameters: [{ $ref: '#/components/parameters/migration-id' }],
    responses: { '302': { description: 'Response' }, '304': { $ref: '#/components/responses/not_modified' },
      '401': { $ref: '#/components/responses/requires_authentication' }, '403': { $ref: '#/components/responses/forbidden' } } },
  { id: 'github:migrations/download-archive-for-org', path: '/orgs/{org}/migrations/{migration_id}/archive',
    parameters: [{ $ref: '#/components/parameters/org' }, { $ref: '#/components/parameters/migration-id' }],
    responses: { '302': { description: 'Response' }, '404': { $ref: '#/components/responses/not_found' } } },
] as const;
const canonical = (value: unknown) => JSON.stringify(value, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const content = { '200': { 'application/gzip': 'binary', 'application/x-gzip': 'binary', 'application/octet-stream': 'binary' } } as const;
const security = [[{ name: 'GitHubClassicUserToken', kind: 'bearer', header: 'Authorization' }]];
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error('GitHub migration archives require the reviewed source and paired archive companion.');
}
export function adaptGithubArchives(document: Record<string, any>): void {
  for (const contract of githubArchiveContracts) {
    const source = document.paths?.[contract.path]?.get;
    requireContract(source?.operationId === contract.id.slice(7) && source.security === undefined
      && source.requestBody === undefined && source['x-operations-github-archive'] === undefined
      && same(source.parameters, contract.parameters) && same(source.responses, contract.responses));
    source['x-operations-github-archive'] = githubArchiveProfile;
  }
}
/** The companion resolves native302 privately and exposes the downloaded file as200. */
export function configureGithubArchive(operation: Operation, source: Record<string, any>): void {
  if (source['x-operations-github-archive'] === undefined) return;
  const contract = githubArchiveContracts.find(contract => contract.id === operation.id);
  requireContract(contract && operation.method === 'GET' && operation.path === contract.path
    && source['x-operations-github-archive'] === githubArchiveProfile
    && same(source.responses, contract.responses) && same(source.parameters, contract.parameters));
  operation.githubArchive = githubArchiveProfile;
  operation.responseContent = structuredClone(content);
  operation.responseMediaType = 'application/gzip';
}
export function isGithubArchive(operation: Operation): boolean {
  const contract = githubArchiveContracts.find(contract => contract.id === operation.id);
  if (operation.githubArchive === undefined) {
    requireContract(!contract || !same(operation.security, security));
    return false;
  }
  requireContract(contract && operation.githubArchive === githubArchiveProfile && operation.method === 'GET'
    && operation.path === contract.path && same(operation.security, security) && same(operation.responseContent, content)
    && operation.responseMediaType === 'application/gzip' && !operation.bodyRequired && !operation.bodySchema
    && !operation.bodyMediaType && !operation.responseStream
    && operation.fields.length === contract.parameters.length
    && operation.fields.every(field => field.location === 'path' && field.required
      && ['migration_id', ...(contract.path.startsWith('/orgs/') ? ['org'] : [])].includes(field.name)));
  return true;
}
/** Used on the host as well: neither queries nor arbitrary destinations are accepted. */
export function githubArchiveAddress(address: string): void {
  requireContract(typeof address === 'string' && address.length < 512
    && /^https:\/\/api\.github\.com\/(?:user|orgs\/[A-Za-z0-9-]{1,100})\/migrations\/[1-9][0-9]{0,15}\/archive$/.test(address));
}
