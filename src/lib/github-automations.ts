// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation, InputField } from './catalog.ts';
import type { PreparedRequest, InputValues } from './operation-input.ts';
import { validatePathParameters } from './parameter-serialization.ts';
import { decodeGithubAutomationData } from './github-automation-data.ts';

type Value = Record<string, any>;
type Projection = { parameters: Value[] | null; requestBody: Value | null; responses: Value };
type Contract = { id: string; method: string; path: string; wirePath: string; upstream: Projection; effective: Projection;
  summary: string; description: string; addedPathParameters: Value[]; currentId: string };
type Contracts = { version: number; profile: string; sourceSha256: string; components: Value; operations: Contract[]; currentSource: Value };
export const githubAutomationProfile = 'github-automations-v1';
const qualifiedRoles = new Set(['GitHubPersonalAccessToken', 'GitHubAppUserToken', 'GitHubInstallationToken', 'GitHubClassicUserToken']);
let cached: Contracts | undefined;
function contracts(): Contracts {
  if (!cached) {
    const data = decodeGithubAutomationData() as Contracts;
    requireContract(data.version === 1 && data.profile === githubAutomationProfile && data.operations.length === 10
      && new Set(data.operations.map(row => row.id)).size === 10 && Object.keys(data.components).length === 0);
    cached = data;
  }
  return cached;
}
export const readGithubAutomationContracts = () => structuredClone(contracts());
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const projection = (operation: Value): Projection => ({ parameters: operation.parameters ?? null,
  requestBody: operation.requestBody ?? null, responses: operation.responses });
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error('GitHub automation correction requires the reviewed native and current request/response contracts.');
}

/** Paths retain native IDs and lookup locations; the finite wire binding handles aliases. */
export function adaptGithubAutomations(document: Value): void {
  requireContract(document.openapi === '3.1.0' && document.info?.title === 'GitHub v3 REST API'
    && document.info.version === '1.1.4' && same(document.servers, [{ url: 'https://api.github.com' }]));
  const plans = contracts().operations.map(contract => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(operation && operation.operationId === contract.id && operation.security === undefined
      && operation['x-operations-github-automation'] === undefined && operation['x-upstream-github-automation'] === undefined
      && same(projection(operation), contract.upstream));
    return { contract, operation };
  });
  for (const { contract, operation } of plans) {
    operation['x-upstream-github-automation'] = structuredClone(contract.upstream);
    operation['x-operations-github-automation'] = githubAutomationProfile;
    for (const key of ['parameters', 'requestBody', 'responses'] as const) {
      if (contract.effective[key] === null) delete operation[key];
      else operation[key] = structuredClone(contract.effective[key]);
    }
    operation.summary = contract.summary;
    operation.description = contract.description;
  }
}

function addedFields(contract: Contract): InputField[] {
  return contract.addedPathParameters.map(parameter => {
    requireContract(['owner', 'repo'].includes(parameter.name) && parameter.in === 'path' && parameter.required === true
      && same(parameter.schema, { type: 'string' }) && typeof parameter.description === 'string');
    return { key: 'path:' + parameter.name, name: parameter.name, label: parameter.name === 'owner' ? 'Owner' : 'Repo',
      location: 'path', type: 'string', schema: { type: 'string' }, required: true, description: parameter.description };
  });
}
function contractFor(operation: Pick<Operation, 'id' | 'method' | 'path'>): Contract | undefined {
  if (!operation.id.startsWith('github:agent-automations/')) return;
  return contracts().operations.find(row => operation.id === 'github:' + row.id && operation.method === row.method && operation.path === row.path);
}
export function requireGithubAutomationSource(operation: Pick<Operation, 'id' | 'method' | 'path'>, source: Value): boolean {
  const marker = source['x-operations-github-automation'];
  if (marker === undefined) {
    const named = Array.isArray(source.security) && source.security.some(option => option && typeof option === 'object'
      && Object.keys(option).some(name => qualifiedRoles.has(name)));
    requireContract(source['x-upstream-github-automation'] === undefined && !(named && contractFor(operation)));
    return false;
  }
  const contract = contractFor(operation);
  requireContract(marker === githubAutomationProfile && contract && same(projection(source), contract.effective)
    && same(source['x-upstream-github-automation'], contract.upstream));
  return true;
}
export function configureGithubAutomation(operation: Operation, source: Value): void {
  if (!requireGithubAutomationSource(operation, source)) return;
  const contract = contractFor(operation)!;
  const fields = addedFields(contract);
  requireContract(fields.every(field => !operation.fields.some(candidate => candidate.key === field.key)));
  operation.fields.push(...fields);
  operation.githubAutomation = githubAutomationProfile;
  validatePathParameters(contract.wirePath, operation.fields);
}
export function githubAutomationWirePath(operation: Operation): string | undefined {
  if (operation.githubAutomation === undefined) {
    const named = operation.security?.some(option => option.some(scheme => qualifiedRoles.has(scheme.name)));
    requireContract(!(named && contractFor(operation)));
    return;
  }
  const contract = contractFor(operation);
  requireContract(operation.githubAutomation === githubAutomationProfile && contract);
  for (const field of addedFields(contract)) {
    const actual = operation.fields.find(candidate => candidate.key === field.key);
    requireContract(actual?.location === 'path' && actual.required === true && actual.type === 'string'
      && same(actual.schema, field.schema));
  }
  validatePathParameters(contract.wirePath, operation.fields);
  return contract.wirePath;
}

/** Known removed semantics must not silently become a default ownership/scope. */
export function githubAutomationRequestIssue(operation: Operation, origin: string, request: PreparedRequest,
  values: InputValues, tokenNames: string[]): { key: string; message: string } | undefined {
  if (operation.githubAutomation === undefined || origin !== 'https://api.github.com') return;
  githubAutomationWirePath(operation);
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Value : {};
  for (const name of ['owner_type', 'write_scope', 'allowed_custom_agents'])
    if (Object.hasOwn(body, name) || Object.hasOwn(values, 'body:' + name))
      return { key: 'body:' + name, message: `Automation parameter ${name} is no longer supported. Review the current type, tool and trigger configuration.` };
  if (Object.hasOwn(values, 'query:owner_type'))
    return { key: 'query:owner_type', message: 'Automation owner_type was replaced by type (personal or shared).' };
  if (operation.method === 'PATCH' && (Object.hasOwn(body, 'type') || Object.hasOwn(values, 'body:type')))
    return { key: 'body:type', message: 'Automation type is fixed at creation and cannot be edited.' };
  const triggers = body.triggers;
  if (triggers && typeof triggers === 'object' && !Array.isArray(triggers)
    && Object.values(triggers).some(value => value && typeof value === 'object' && Object.hasOwn(value, 'write_scope')))
    return { key: 'body:triggers', message: 'Automation trigger write_scope is no longer supported. Review the current trigger configuration.' };
  if (tokenNames.includes('GitHubInstallationToken')) {
    if (operation.method === 'POST' && body.type !== 'shared')
      return { key: 'body:type', message: 'An installation token can create only shared automations; choose type shared or a user token.' };
    if (request.query.type === 'personal')
      return { key: 'query:type', message: 'Personal automations require a user token; installation tokens can access shared automations only.' };
  }
  return;
}
