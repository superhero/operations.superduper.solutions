// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { createSchemaDocumentId, operationServerUrl, parseSchemaDocument, schemaDocumentMaxBytes, validateSchemaDocument }
  from "./lib/schema-documents.ts";
import { bundledCatalogs } from "./lib/catalog-registry.ts";

const response = { "200": { description: "OK" } };
const document = (operation = {}, extra = {}) => ({
  openapi: "3.1.0", info: { title: "Uploaded API", version: "1" }, servers: [{ url: "https://api.example.test/v1" }],
  paths: { "/items": { get: { operationId: "listItems", responses: response, ...operation } } }, ...extra,
});

Then("JSON and YAML imports retain complete documents and support bounded aliases", () => {
  const value = document({}, { "x-vendor-data": { retained: true } });
  assert.deepEqual(parseSchemaDocument(JSON.stringify(value), "upload.JSON"), value);
  const parsed = parseSchemaDocument(`openapi: 3.1.0
info: {title: Uploaded API, version: '1'}
servers: [{url: 'https://api.example.test/v1'}]
paths:
  /items:
    get:
      operationId: listItems
      responses:
        200: &response {description: OK}
        201: *response
x-vendor-data: {retained: true}
`, "upload.yaml");
  assert.equal(parsed.paths["/items"].get.responses["201"].description, "OK");
  assert.equal(validateSchemaDocument(parsed, "import-1").name, "Uploaded API");
  assert.equal(parsed["x-vendor-data"].retained, true);
});

Then("malformed, ambiguous and non-JSON YAML content fails before extraction", () => {
  for (const [source, filename] of [
    ["{", "bad.json"], ["a: 1\na: 2", "bad.yaml"], ["a: .inf", "bad.yml"], ["a: !unknown value", "bad.yaml"],
    ["a: &loop [*loop]", "bad.yaml"], ["? [a, b]\n: c", "bad.yaml"], ["---\na: b\n---\na: c", "bad.yaml"],
    ["{}", "bad.txt"],
  ]) assert.throws(() => parseSchemaDocument(source, filename), /Could not parse/);
  let aliases = "a: &a [one, two]\n";
  for (const [name, previous] of [["b", "a"], ["c", "b"], ["d", "c"], ["e", "d"]])
    aliases += `${name}: &${name} [*${previous}, *${previous}, *${previous}, *${previous}, *${previous}]\n`;
  assert.throws(() => parseSchemaDocument(aliases, "aliases.yaml"), /alias|resource/i);
  assert.throws(() => parseSchemaDocument(" ".repeat(schemaDocumentMaxBytes + 1), "large.json"), /10 MiB/);
});

Then("expanded documents reject excessive nesting, bytes, incompatible objects, and ambiguous mapping keys", () => {
  let nested = null;
  for (let index = 0; index < 102; index++) nested = { nested };
  assert.throws(() => validateSchemaDocument(document({}, { "x-nested": nested }), "test"), /nesting or expanded value limit/);
  assert.throws(() => validateSchemaDocument(document({}, { "x-large": "a".repeat(schemaDocumentMaxBytes) }), "test"), /expanded document exceeds the 10 MiB/);
  assert.throws(() => validateSchemaDocument(document({}, { "x-date": new Date(0) }), "test"), /JSON-compatible objects/);
  assert.throws(() => parseSchemaDocument("values: {1: first, '1': second}", "ambiguous.yaml"), /Duplicate mapping key: 1/);
  const metadata = Object.assign(Object.create(null), { retained: "safe" });
  assert.deepEqual(validateSchemaDocument(document({}, { "x-metadata": metadata }), "test").document["x-metadata"], { retained: "safe" });
});

Then("parser failures retain non-Error causes with the uploaded filename", () => {
  const originalParse = JSON.parse;
  try {
    JSON.parse = () => { throw "parser unavailable"; };
    assert.throws(() => parseSchemaDocument("{}", "unavailable.json"), error =>
      error.message === "Could not parse unavailable.json: parser unavailable" && error.cause === "parser unavailable");
  } finally {
    JSON.parse = originalParse;
  }
});

Then("imports use opaque identities and title collisions do not merge operation namespaces", () => {
  const firstId = createSchemaDocumentId();
  const secondId = createSchemaDocumentId();
  assert.notEqual(firstId, secondId);
  assert.doesNotMatch(firstId, /[:/\\]/);
  assert.equal(validateSchemaDocument(document(), firstId).operations[0].id, `${firstId}:listItems`);
  assert.equal(validateSchemaDocument(document(), secondId).operations[0].id, `${secondId}:listItems`);
  for (const id of ["", "../escape", "other:id", "a/b", "a\\b"])
    assert.throws(() => validateSchemaDocument(document(), id), /schema ID/);
});

Then("required metadata and invalid operation definitions have invalid-document diagnostics", () => {
  for (const value of [
    document({}, { info: {} }), document({}, { info: { title: " ", version: "1" } }),
    document({}, { info: { title: "A", version: 1 } }), document({ operationId: 1 }),
    document({ responses: {} }), document({ parameters: "bad" }),
    document({}, { openapi: "invalid" }), document({ responses: { "200": {} } }), document({ responses: { "200": { description: "OK" }, nope: {} } }),
    document({ parameters: [{ in: "query", name: "x", schema: { type: "number", minimum: 5, maximum: 2 } }] }),
  ]) assert.throws(() => validateSchemaDocument(value, "test"), /Invalid OpenAPI document/);
  const duplicate = document({}, { paths: {
    "/one": { get: { operationId: "duplicate", responses: response } },
    "/two": { get: { operationId: "duplicate", responses: response } },
  } });
  assert.throws(() => validateSchemaDocument(duplicate, "test"), /duplicate operation identifier/);
});

Then("valid OpenAPI features outside the executable subset say unsupported", () => {
  const parameter = schema => [{ in: "query", name: "x", schema }];
  for (const value of [
    document({}, { openapi: "3.2.0" }), document({ parameters: parameter({ type: "string", format: "uuid" }) }),
    document({ parameters: parameter({ oneOf: [{ type: "string" }, { type: "number" }] }) }),
    document({ parameters: parameter({ $ref: "https://api.example.test/type.json" }) }),
    document({ requestBody: { content: { "application/octet-stream": { schema: { type: "string" } } } } }),
    document({}, { security: [{ apiKey: [] }] }), document({ callbacks: { changed: {} } }),
  ]) assert.throws(() => validateSchemaDocument(value, "test"), /Unsupported by this application/);
  assert.equal(validateSchemaDocument(document({ security: [] }, { security: [{ apiKey: [] }] }), "test").operations.length, 1);
});

Then("tag groups are namespaced, preserve descriptions and include untagged operations", () => {
  const value = document({ tags: ["Items"] }, {
    tags: [{ name: "Items", description: "Manage inventory" }],
    paths: {
      "/items": { get: { tags: ["Items"], operationId: "list", responses: response } },
      "/status": { get: { operationId: "status", responses: response } },
    },
  });
  const result = validateSchemaDocument(value, "upload");
  assert.equal(result.groups[0].id, "upload");
  assert.equal(result.groups[0].name, "api.example.test");
  assert.equal(result.groups[0].description, "Uploaded API");
  const groups = result.groups[0].children;
  assert.deepEqual(groups.map(group => [group.id, group.name, group.operationIds]), [
    ["upload:tag:Items", "Items", ["upload:list"]], ["upload:tag:Operations", "Operations", ["upload:status"]],
  ]);
  assert.equal(groups[0].description, "Manage inventory");
});

Then("effective servers retain base paths, resolve defaults and follow operation and path precedence", () => {
  const value = document({}, { servers: [{ url: "https://{host}/v{version}", variables: {
    host: { default: "api.example.test" }, version: { default: "2", enum: ["1", "2"] },
  } }] });
  assert.equal(validateSchemaDocument(value, "test").serverUrl, "https://api.example.test/v2");
  value.paths["/items"].servers = [{ url: "/path/base/" }];
  assert.equal(operationServerUrl(value, { path: "/items", method: "GET" }), "https://api.example.test/path/base");
  value.paths["/items"].get.servers = [{ url: "https://operation.example.test/prefix" }];
  assert.equal(operationServerUrl(value, { path: "/items", method: "GET" }), "https://operation.example.test/prefix");
  value.paths["/items"].get.servers = [];
  assert.equal(operationServerUrl(value, { path: "/items", method: "GET" }), "https://api.example.test");
  value.paths["/items"].get.servers = [{ url: "https://operation.example.test/prefix" }];
  delete value.servers;
  delete value.paths["/items"].servers;
  assert.equal(validateSchemaDocument(value, "test").serverUrl, "https://operation.example.test/prefix");
  const encoded = document({}, { servers: [{ url: "https://{host}:{port}/{base}/bot{botToken}", variables: {
    host: { default: "api.example.test" }, port: { default: "443" },
    base: { default: "teams/acme%20ops/%E2%82%AC" }, botToken: { default: "123456:sample-token" },
  } }] });
  const original = structuredClone(encoded);
  assert.equal(validateSchemaDocument(encoded, "test").serverUrl,
    "https://api.example.test/teams/acme%20ops/%E2%82%AC/bot123456:sample-token");
  assert.deepEqual(encoded, original);
  const override = document({}, { servers: [{ url: "https://api.example.test/bot{botToken}",
    variables: { botToken: { default: "<bot_token>" } } }] });
  override.paths["/items"].servers = [{ url: "https://path.example.test/ready" }];
  assert.equal(validateSchemaDocument(override, "test").serverUrl, "https://path.example.test/ready");
  override.paths["/items"].servers = [{ url: "https://path.example.test/{unconfigured}" }];
  override.paths["/items"].get.servers = [{ url: "https://operation.example.test/ready" }];
  assert.equal(validateSchemaDocument(override, "test").serverUrl, "https://operation.example.test/ready");
});

Then(/^the (document|path|operation) server (.+) is rejected as an unresolved placeholder$/, (level, definition) => {
  const value = document();
  const parent = level === "document" ? value : level === "path" ? value.paths["/items"] : value.paths["/items"].get;
  parent.servers = [JSON.parse(definition)];
  const original = structuredClone(value);
  assert.throws(() => validateSchemaDocument(value, "test"), /still contains a placeholder/);
  assert.deepEqual(value, original, "Reject placeholders without rewriting the original schema.");
});

Then("local Path Item references retain inherited parameters and server overrides", () => {
  const value = document({}, {
    paths: { "/items/{id}": { $ref: "#/components/pathItems/item" } },
    components: { pathItems: { item: {
      servers: [{ url: "https://path.example.test/api" }],
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      get: { operationId: "read", responses: response },
    } } },
  });
  const result = validateSchemaDocument(value, "test");
  assert.equal(result.operations[0].fields[0].name, "id");
  assert.equal(operationServerUrl(value, result.operations[0]), "https://path.example.test/api");
  value.components.pathItems.item = { $ref: "#/components/pathItems/item" };
  assert.throws(() => validateSchemaDocument(value, "test"), /cyclic or malformed reference/);
});

Then("path and response references reject unsafe targets without silently dropping sibling fields", () => {
  for (const [reference, reason] of [
    [{ $ref: 4 }, /\$ref must be a string/],
    [{ $ref: "https://remote.example.test/paths.json" }, /only local document references/],
    [{ $ref: "#/paths/other", description: "ignored sibling" }, /references with sibling fields/],
    [{ $ref: "#/components/pathItems/missing" }, /reference .* must be an object/],
  ]) {
    const value = document({}, { components: { pathItems: {} } });
    value.paths["/items"] = reference;
    assert.throws(() => validateSchemaDocument(value, "test"), reason);
  }
  assert.throws(() => validateSchemaDocument(document({}, {
    paths: { "/bad%ZZ": { get: { responses: response } } },
  }), "test"), /malformed percent encoding/);
});

Then("server definitions require valid URL strings and usable variable defaults", () => {
  for (const [servers, reason] of [
    [{ url: "https://api.example.test" }, /servers must be an array/],
    [[{ url: 5 }], /server url must be a nonempty string/],
    [[{ url: " " }], /server url must be a nonempty string/],
    [[{ url: "https://{host}", variables: { host: { default: 5 } } }], /requires a string default/],
    [[{ url: "https://{host}", variables: { host: { default: "api.example.test", enum: "api.example.test" } } }], /default must belong to its enum/],
    [[{ url: "https://{host}", variables: { host: { default: "api.example.test", enum: ["other.example.test"] } } }], /default must belong to its enum/],
    [[{ url: "https://api.example.test/unsafe path" }], /unresolved variables or unsafe characters/],
  ]) assert.throws(() => validateSchemaDocument(document({}, { servers }), "test"), reason);
});

Then("vendor extensions and empty webhooks remain metadata while executable webhooks and Swagger are rejected", () => {
  const value = document({ responses: { ...response, "x-response-note": "retained" } }, { webhooks: {} });
  value.paths["x-path-note"] = "retained";
  const validated = validateSchemaDocument(value, "test");
  assert.equal(validated.operations.length, 1);
  assert.equal(validated.document.paths["x-path-note"], "retained");
  assert.equal(validated.document.paths["/items"].get.responses["x-response-note"], "retained");
  assert.throws(() => validateSchemaDocument(document({}, { webhooks: { changed: {} } }), "test"), /Webhook operations are not executable/);
  assert.throws(() => validateSchemaDocument(document({}, { swagger: "2.0" }), "test"), /Only OpenAPI 3.0 and 3.1/);
});

Then("unsafe paths and unusable servers are rejected instead of routing to the application origin", () => {
  for (const path of ["//other.example.test", "/../admin", "/%2e%2e/admin", "/one//two", "/one\\two", "/%2fhost", "/items?x=1", "/items#fragment"])
    assert.throws(() => validateSchemaDocument(document({}, { paths: { [path]: { get: { responses: response } } } }), "test"), /Unsupported by this application/);
  for (const servers of [undefined, [], [{ url: "/api" }], [{ url: "file:///tmp/api" }], [{ url: "https://u:p@example.test" }],
    [{ url: "https://api.example.test?secret=key" }], [{ url: "https://api.example.test/{version}" }]])
    assert.throws(() => validateSchemaDocument(document({}, { servers }), "test"), /JSON-compatible|Unsupported by this application|Invalid OpenAPI document/);
});

Then("both bundled schemas remain valid with their durable operation identifiers", () => {
  for (const catalog of bundledCatalogs)
  {
    const result = validateSchemaDocument(catalog.document, catalog.id);
    assert.ok(result.operations.length);
    assert.ok(result.operations.every(operation => operation.id.startsWith(`${catalog.id}:`)));
    assert.equal(result.serverUrl, catalog.execution.origin);
  }
});
