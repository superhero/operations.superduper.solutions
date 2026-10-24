// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { extractCredentialPermissions, extractOperationSecurity, inspectOperationSecurity, supportedSecurityAlternative, securityRequiresCredentials } from "./lib/operation-security.ts";
import { inspectServiceSchema } from "./lib/service-catalog.ts";
import { approvedOperation } from "./lib/secrets/policy.ts";
import { extractOperations } from "./lib/catalog.ts";
import { bundledCatalogs } from "./lib/catalog-registry.ts";
import { validateSchemaDocument } from "./lib/schema-documents.ts";

Then('HTTP Basic preserves scheme identity destination AND requirements and strict approval', async () => {
  const source = document(); source.components.securitySchemes.Login = { type: 'http', scheme: 'BaSiC' };
  source.security = [{ Login: [], Key: [] }, { Bearer: [] }, {}];
  const parsed = extractOperationSecurity(source, operation(source));
  assert.deepEqual(parsed[0], [{ name: 'Login', kind: 'basic', header: 'Authorization' }, normalized.Key]);
  assert.ok(supportedSecurityAlternative(parsed[0]));
  const model = validateSchemaDocument(source, 'basic').operations[0];
  assert.deepEqual(model.security, parsed);
  assert.deepEqual((await approvedOperation(model, source.servers[0].url)).operation.security, parsed);
  for (const wrong of [{ ...parsed[0][0], header: 'X-Login' }, { ...parsed[0][0], query: 'login' }]) {
    await assert.rejects(approvedOperation({ ...model, security: [[wrong]] }, source.servers[0].url), { code: 'PERMISSION' });
  }
  source.security = [{ Login: [], Bearer: [] }];
  assert.throws(() => extractOperationSecurity(source, operation(source)), /duplicate credential header/);
});

Then('credential permission metadata is validated at schema loading and private approval', async () => {
  const security = [[{ name: 'Token', kind: 'bearer', header: 'Authorization' }], [], [{ name: 'Key', kind: 'apiKey', query: 'key' }]];
  const permissions = [{ Token: ['droplet:read', 'droplet:create'] }, {}, {}];
  const copied = extractCredentialPermissions(permissions, security);
  assert.deepEqual(copied, permissions);
  assert.notEqual(copied[0].Token, permissions[0].Token);
  assert.equal(extractCredentialPermissions(undefined, undefined), undefined);
  assert.deepEqual(extractCredentialPermissions([], []), []);
  const source = { openapi: '3.0.3', info: { title: 'Permissions', version: '1' }, servers: [{ url: 'https://api.example.test' }],
    components: { securitySchemes: { Token: { type: 'http', scheme: 'bearer' }, Key: { type: 'apiKey', in: 'query', name: 'key' } } },
    security: [{ Token: [] }, {}, { Key: [] }], 'x-credential-permissions': permissions, paths: { '/items': { get: {} } } };
  const model = inspectServiceSchema(source, 'permissions').operations[0];
  assert.equal(model.unavailableReason, undefined);
  assert.deepEqual(model.credentialPermissions, permissions);
  assert.deepEqual((await approvedOperation(model, source.servers[0].url)).operation.credentialPermissions, permissions);
  for (const invalid of [null, {}, [], [null, {}, {}], [[], {}, {}], [{ Token: [] }, {}, {}], [{ Token: null }, {}, {}],
    [{ Token: [1] }, {}, {}], [{ Token: [''] }, {}, {}], [{ Token: [' '] }, {}, {}], [{ Token: [' read'] }, {}, {}],
    [{ Missing: ['read'] }, {}, {}], [{}, { Token: ['read'] }, {}], [{}, {}, { Key: ['read'] }]]) {
    assert.throws(() => extractCredentialPermissions(invalid, security), /Credential permissions/);
    const bad = structuredClone(source); bad['x-credential-permissions'] = invalid;
    assert.match(inspectServiceSchema(bad, 'permissions').operations[0].unavailableReason, /Credential permissions/);
    await assert.rejects(approvedOperation({ ...model, credentialPermissions: invalid }, source.servers[0].url), { code: 'PERMISSION' });
  }
  assert.throws(() => extractCredentialPermissions([{}], undefined), /match the security/);
  await assert.rejects(approvedOperation({ ...model, security: undefined }, source.servers[0].url), { code: 'PERMISSION' });
  const absent = structuredClone(source); delete absent.security;
  assert.match(inspectServiceSchema(absent, 'permissions').operations[0].unavailableReason, /match the security/);
  const overridden = structuredClone(source); overridden.paths['/items'].get.security = [];
  assert.equal(inspectServiceSchema(overridden, 'permissions').operations[0].credentialPermissions, undefined);
  overridden.paths['/items'].get['x-credential-permissions'] = null;
  assert.match(inspectServiceSchema(overridden, 'permissions').operations[0].unavailableReason, /Credential permissions/);
});

Then('unavailable HTTP choices retain source indices AND members and explicit anonymous alternatives', async () => {
  const source = document(); source.components.securitySchemes.Digest = { type: 'http', scheme: 'digest' };
  source.security = [{ Digest: [], Key: [] }, { Bearer: [] }, {}];
  const before = structuredClone(source), inspected = inspectOperationSecurity(source, operation(source));
  assert.deepEqual(source, before);
  assert.equal(inspected.length, 3);
  assert.equal(inspected[0][0].kind, 'unsupported');
  assert.equal(inspected[0][0].name, 'Digest');
  assert.equal(inspected[0][0].header, 'Authorization');
  assert.match(inspected[0][0].reason, /only HTTP bearer/);
  assert.deepEqual(inspected[0][1], normalized.Key);
  assert.deepEqual(inspected[1], [normalized.Bearer]);
  assert.deepEqual(inspected[2], []);
  assert.equal(supportedSecurityAlternative(inspected[0]), false);
  assert.equal(supportedSecurityAlternative(inspected[1]), true);
  assert.equal(supportedSecurityAlternative(inspected[2]), true);
  assert.equal(supportedSecurityAlternative(undefined), false);
  assert.equal(supportedSecurityAlternative([null]), false);
  assert.equal(securityRequiresCredentials(inspected), false);
  assert.equal(securityRequiresCredentials(inspected.slice(0, 2)), true);
  assert.throws(() => extractOperationSecurity(source, operation(source)), /only HTTP bearer/);
  const model = validateSchemaDocument(source, 'auth-alternatives').operations[0];
  assert.deepEqual(model.security, inspected);
  assert.deepEqual(inspectServiceSchema(source, 'auth-alternatives').operations[0].security, inspected);
  const approved = await approvedOperation(model, source.servers[0].url);
  assert.deepEqual(approved.operation.security, inspected);
  const supported = document(); supported.security = [{ Bearer: [] }, { Key: [] }, {}];
  const legacy = validateSchemaDocument(supported, 'unchanged').operations[0];
  const strict = { ...legacy, security: extractOperationSecurity(supported, operation(supported)) };
  assert.deepEqual((await approvedOperation(legacy, supported.servers[0].url)), await approvedOperation(strict, supported.servers[0].url),
    'Existing all-supported metadata and approval fingerprints stay identical.');
  for (const patch of [scheme => { scheme.reason = ''; }, scheme => { scheme.reason = 'x'.repeat(4097); },
    scheme => { scheme.extra = true; }, scheme => { scheme.header = 'Cookie'; }, scheme => { scheme.query = 'key'; }]) {
    const invalid = structuredClone(model); patch(invalid.security[0][0]);
    await assert.rejects(approvedOperation(invalid, source.servers[0].url), { code: 'PERMISSION' });
  }
  await assert.rejects(approvedOperation({ ...model, security: [inspected[0]] }, source.servers[0].url), { code: 'PERMISSION' });
  await assert.rejects(approvedOperation({ ...model, security: [null, inspected[1]] }, source.servers[0].url), { code: 'PERMISSION' });
});

Then('unsupported signing stays unavailable beside a supported credential alternative', async () => {
  const source = document();
  source.components.securitySchemes.Signed = { type: 'apiKey', in: 'query', name: 'signed', 'x-amazon-apigateway-authtype': 'awsSigv4' };
  source.security = [{ Signed: [] }, { Bearer: [] }];
  const model = inspectServiceSchema(source, 'auth-signing').operations[0];
  assert.equal(model.unavailableReason, undefined);
  assert.equal(model.security[0][0].kind, 'unsupported');
  assert.equal(model.security[0][0].query, 'signed');
  assert.match(model.security[0][0].reason, /Signature Version 4/);
  assert.deepEqual((await approvedOperation(model, source.servers[0].url)).operation.security, model.security);
  source.security = [{ Signed: [] }];
  assert.match(inspectServiceSchema(source, 'auth-signing').operations[0].unavailableReason, /Signature Version 4/);
  source.components.securitySchemes.Signed = { type: 'oauth2', 'x-amazon-apigateway-authtype': 'awsSigv4',
    flows: { clientCredentials: { tokenUrl: 'https://example.test/token', scopes: { read: 'Read' } } } };
  source.security = [{ Signed: ['read'] }, { Bearer: [] }];
  const adapted = inspectServiceSchema(source, 'auth-signing').operations[0];
  assert.equal(adapted.unavailableReason, undefined);
  assert.equal(adapted.security[0][0].kind, 'unsupported', 'OAuth adaptation cannot remove a signing requirement.');
  assert.equal(adapted.security[0][0].header, 'Authorization');
  assert.deepEqual(adapted.oauthScopes[0], { Signed: ['read'] });
  assert.deepEqual((await approvedOperation(adapted, source.servers[0].url)).operation.security, adapted.security);
  source.security = [{ Signed: ['read'] }];
  assert.match(inspectServiceSchema(source, 'auth-signing').operations[0].unavailableReason, /Signature Version 4/);
});

Then('a malformed mixed authentication choice {string} still rejects the complete operation', kind => {
  const source = document(); source.components.securitySchemes.Digest = { type: 'http', scheme: 'digest' };
  source.security = [{ Digest: [] }, { Bearer: [] }];
  const corrupt = {
    'undeclared scheme': () => { source.security[0] = { Missing: [] }; },
    'nonempty scopes': () => { source.security[0].Digest = ['scope']; },
    'invalid alternative': () => { source.security[0] = []; },
    'missing scheme': () => { delete source.components.securitySchemes.Digest.scheme; },
    'invalid HTTP token': () => { source.components.securitySchemes.Digest.scheme = 'invalid scheme'; },
    'unknown scheme fields': () => { source.components.securitySchemes.Digest.flows = {}; },
    'invalid description': () => { source.components.securitySchemes.Digest.description = []; },
    'duplicate headers': () => { source.security[0] = { Digest: [], Bearer: [] }; },
    'duplicate queries': () => { source.security[0] = { Digest: [], Query: [], QueryAlias: [] }; },
  };
  assert.ok(corrupt[kind]); corrupt[kind]();
  assert.throws(() => inspectOperationSecurity(source, operation(source)));
  assert.ok(inspectServiceSchema(source, 'malformed-alternatives').operations[0].unavailableReason);
  assert.throws(() => validateSchemaDocument(source, 'malformed-alternatives'));
});

const schemes = {
  Bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token", "x-display": "Token" },
  Key: { type: "apiKey", in: "header", name: "X-Api-Key", description: "Account key" },
  Backup: { type: "apiKey", in: "header", name: "x-api-key" },
  Authorization: { type: "apiKey", in: "header", name: "authorization" },
  Query: { type: "apiKey", in: "query", name: "api_key" },
  QueryAlias: { type: "apiKey", in: "query", name: "api_key" },
  UpperQuery: { type: "apiKey", in: "query", name: "API_KEY" },
};
const normalized = {
  Bearer: { name: "Bearer", kind: "bearer", header: "Authorization" },
  Key: { name: "Key", kind: "apiKey", header: "X-Api-Key" },
  Backup: { name: "Backup", kind: "apiKey", header: "x-api-key" },
  Query: { name: "Query", kind: "apiKey", query: "api_key" },
  UpperQuery: { name: "UpperQuery", kind: "apiKey", query: "API_KEY" },
};
const document = () => ({
  openapi: "3.1.0", info: { title: "Credential API", version: "1" },
  servers: [{ url: "https://api.example.test/v1" }],
  paths: { "/items": { get: { operationId: "listItems", responses: { "200": { description: "OK" } } } } },
  components: { securitySchemes: structuredClone(schemes) },
});
const operation = value => value.paths["/items"].get;

Given(/^root authentication (.+) and operation authentication (.+)$/, function (root, local) {
  this.authenticationDocument = document();
  if (root !== "absent") this.authenticationDocument.security = JSON.parse(root);
  if (local !== "absent") operation(this.authenticationDocument).security = JSON.parse(local);
});

Then(/^normalized authentication is (.+) and credentials are (required|optional)$/, function (expected, required) {
  const before = structuredClone(this.authenticationDocument);
  const result = extractOperationSecurity(this.authenticationDocument, operation(this.authenticationDocument));
  const expectation = expected === "absent" ? undefined : JSON.parse(expected).map(names => names.map(name => normalized[name]));
  assert.deepEqual(result, expectation);
  assert.equal(securityRequiresCredentials(result), required === "required");
  assert.deepEqual(this.authenticationDocument, before);
  const imported = validateSchemaDocument(this.authenticationDocument, "auth").operations[0];
  assert.deepEqual(imported.security, expectation);
  assert.equal(Object.hasOwn(imported, "security"), expected !== "absent");
});

Then("schema import preserves supported authentication metadata and anonymous operation shapes", () => {
  for (const version of ["3.0.3", "3.1.0"]) {
    const value = document();
    value.openapi = version;
    value.security = [{ Bearer: [], Key: [] }];
    const imported = validateSchemaDocument(value, "auth");
    assert.deepEqual(imported.document, value);
    assert.deepEqual(imported.operations[0].security, [[normalized.Bearer, normalized.Key]]);
    assert.deepEqual(imported.operations[0].fields, []);
  }
  for (const catalog of bundledCatalogs) {
    const imported = validateSchemaDocument(catalog.document, catalog.id).operations;
    assert.deepEqual(imported, extractOperations(catalog.document, catalog.id));
    assert.ok(imported.every(value => !Object.hasOwn(value, "security")));
  }
});

Then("reusing an operation identifier does not supply an authentication declaration", () => {
  const protectedDocument = document();
  protectedDocument.security = [{ Bearer: [] }];
  const anonymousDocument = document();
  assert.equal(extractOperations(protectedDocument, "same")[0].id, extractOperations(anonymousDocument, "same")[0].id);
  assert.equal(securityRequiresCredentials(extractOperations(protectedDocument, "same")[0].security), true);
  assert.equal(securityRequiresCredentials(extractOperations(anonymousDocument, "same")[0].security), false);
});

Given(/^authentication scheme (.+)$/, function (definition) {
  this.authenticationDocument = document();
  this.authenticationDocument.components.securitySchemes.Test = JSON.parse(definition);
  operation(this.authenticationDocument).security = [{ Test: [] }];
});

Given("an API key in header {string}", function (header) {
  this.authenticationDocument = document();
  this.authenticationDocument.components.securitySchemes.Test = { type: "apiKey", in: "header", name: header };
  operation(this.authenticationDocument).security = [{ Test: [] }];
});

Given(/^authentication containers (.+)$/, function (containers) {
  this.authenticationDocument = document();
  delete this.authenticationDocument.components;
  Object.assign(this.authenticationDocument, JSON.parse(containers));
  operation(this.authenticationDocument).security = [{ Bearer: [] }];
});

Then("authentication extraction fails with {string}", function (diagnostic) {
  const check = error => error instanceof Error && error.message.includes(diagnostic);
  assert.throws(() => extractOperationSecurity(this.authenticationDocument, operation(this.authenticationDocument)), check);
  assert.throws(() => validateSchemaDocument(this.authenticationDocument, "auth"), check);
});

Then("local authentication references preserve aliases and resolve escaped pointer tokens", () => {
  const value = document();
  value.components.securitySchemes["escaped/~ space"] = { type: "http", scheme: "BEARER" };
  value.components.securitySchemes.Alias = { $ref: "#/components/securitySchemes/escaped~1~0%20space" };
  value.components.securitySchemes.Chained = { $ref: "#/components/securitySchemes/Alias" };
  operation(value).security = [{ Chained: [] }];
  assert.deepEqual(validateSchemaDocument(value, "auth").operations[0].security,
    [[{ name: "Chained", kind: "bearer", header: "Authorization" }]]);
});

Then("indirect security reference cycles fail without resolving external documents", () => {
  const value = document();
  value.components.securitySchemes.First = { $ref: "#/components/securitySchemes/Second" };
  value.components.securitySchemes.Second = { $ref: "#/components/securitySchemes/%46irst" };
  operation(value).security = [{ First: [] }];
  assert.throws(() => validateSchemaDocument(value, "auth"), /cyclic or malformed security scheme reference/);
});

Then("undefined authentication declarations inherit the root requirements", () => {
  const value = document();
  operation(value).security = undefined;
  value.security = [{ Bearer: [] }];
  assert.deepEqual(extractOperationSecurity(value, operation(value)), [[normalized.Bearer]]);
  value.security = undefined;
  assert.equal(extractOperationSecurity(value, operation(value)), undefined);
});
