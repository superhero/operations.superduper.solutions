// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { operations } from "./lib/catalog.ts";
import { catalogs, catalogForOperation } from "./lib/catalog-registry.ts";
import { getOperationReport, scopeOperationSchema } from "./lib/operation-report.ts";

const selectedPath = "/items";
const schemaReference = name => ({ $ref: `#/components/schemas/${name}` });
const fixture = (operation = {}, item = {}) => ({
  openapi: "3.1.0",
  info: { title: "Example catalog", version: "1.0.0" },
  paths: { [selectedPath]: { ...item, get: { operationId: "readItems", responses: {}, ...operation } } }
});
const scope = document => scopeOperationSchema(document, selectedPath, "GET");
const response = schema => ({ "200": { description: "An item", content: { "application/json": { schema } } } });

Then("every bundled example has an independent source report and described group path", function () {
  const before = structuredClone({ catalogs, operations });
  const groupNames = { Projects: "Overview", Tasks: "Tasks", "HTTP methods": "HTTP methods", "Input types": "Input types", "Body formats": "Body formats" };
  for (const operation of operations) {
    const catalog = catalogForOperation(operation.id);
    const document = catalog.document;
    const report = getOperationReport(operation);
    const source = document.paths[operation.path][operation.method.toLowerCase()];
    assert.deepEqual(report.catalog, { file: catalog.file, title: document.info.title, version: document.info.version, openapi: document.openapi });
    assert.equal(report.operationId, source.operationId);
    assert.equal(report.summary, source.summary);
    assert.equal(report.description, source.description);
    assert.deepEqual(report.groups.map(group => group.name), [catalog.name, groupNames[operation.group]]);
    assert.ok(report.groups.every(group => group.id && group.description.length > 20));
    assert.deepEqual(Object.keys(report.schema.paths), [operation.path]);
    assert.deepEqual(report.warnings, []);
    report.schema.info.title = "Changed report copy";
    report.groups[0].description = "Changed group copy";
    assert.equal(getOperationReport(operation).catalog.title, document.info.title);
    assert.notEqual(getOperationReport(operation).groups[0].description, "Changed group copy");
  }
  const changedLabel = { ...operations[0], name: "A local label", description: "A local description" };
  assert.equal(getOperationReport(changedLabel).summary, operations[0].name);
  assert.deepEqual({ catalogs, operations }, before);
});

Then("the example registries send requests to their declared example.com and HTTPBin endpoints", function () {
  assert.deepEqual(catalogs.map(catalog => [catalog.id, catalog.name, catalog.execution]), [
    ["demo", "example.com", { kind: "http", origin: "https://example.com" }],
    ["httpbin", "httpbin.org", { kind: "http", origin: "https://httpbin.org" }]
  ]);
  const expectedMethods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"];
  for (const catalog of catalogs) {
    const selected = operations.filter(operation => catalogForOperation(operation.id) === catalog);
    assert.deepEqual([...new Set(selected.map(operation => operation.method))].sort(),
      catalog.id === "demo" ? [...expectedMethods, "TRACE"] : expectedMethods);
    assert.deepEqual(catalog.document.servers.map(server => server.url), [catalog.execution.origin]);
    assert.ok(selected.every(operation => getOperationReport(operation).schema.servers[0].url === catalog.execution.origin));
    assert.ok(selected.some(operation => operation.fields.some(field => field.type === "object")));
    assert.ok(selected.some(operation => operation.fields.some(field => field.type === "array")));
    assert.ok(selected.some(operation => operation.fields.some(field => field.type === "null")));
    assert.ok(selected.some(operation => operation.fields.some(field => field.location === "header")));
    const media = new Set(selected.flatMap(operation => {
      const source = catalog.document.paths[operation.path][operation.method.toLowerCase()];
      return Object.keys(source.requestBody?.content ?? {});
    }));
    assert.deepEqual([...media].sort(), ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);
  }
  for (const id of ["unknown:echoGet", "httpbinish:echoGet", "demonstration:listProjects", "demo", "echoGet", ""]) {
    assert.equal(catalogForOperation(id), undefined);
  }
  const legacy = operations.filter(operation => ["demo:listProjects", "demo:getProject", "demo:createTask", "demo:updateTask"].includes(operation.id));
  assert.deepEqual(legacy.map(operation => [operation.id, operation.name, operation.method, operation.path]), [
    ["demo:listProjects", "List projects", "GET", "/projects"],
    ["demo:getProject", "Get project", "GET", "/projects/{projectId}"],
    ["demo:createTask", "Create task", "POST", "/projects/{projectId}/tasks"],
    ["demo:updateTask", "Update task", "PATCH", "/tasks/{taskId}"]
  ]);
  assert.equal(new Set(operations.map(operation => operation.name)).size, operations.length);
});

Then("operation schema reports preserve metadata and inherited parameters without unrelated operations", function () {
  const document = fixture({ summary: "Read items", description: "Inspect available items", responses: response(schemaReference("Item")) }, {
    summary: "Item operations", description: "Shared endpoint context",
    parameters: [{ $ref: "#/components/parameters/Limit" }],
    post: { operationId: "createItem" }, "x-note": { value: "Kept source annotation" }
  });
  document.jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";
  document.paths["/other"] = { get: { operationId: "other" } };
  document.components = {
    parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" } }, Unused: { name: "unused", in: "query" } },
    schemas: { Item: { type: "object", properties: { id: { type: "string" } } }, Unused: { type: "boolean" } }
  };
  const before = structuredClone(document);
  const { schema, warnings } = scope(document);
  assert.deepEqual(schema.info, document.info);
  assert.equal(schema.openapi, document.openapi);
  assert.equal(schema.jsonSchemaDialect, document.jsonSchemaDialect);
  assert.deepEqual(schema.servers, [{ url: "/" }]);
  assert.equal("security" in schema, false);
  assert.deepEqual(Object.keys(schema.paths), [selectedPath]);
  assert.deepEqual(Object.keys(schema.paths[selectedPath]), ["summary", "description", "parameters", "x-note", "get"]);
  assert.deepEqual(schema.paths[selectedPath].parameters, document.paths[selectedPath].parameters);
  assert.deepEqual(Object.keys(schema.components.schemas), ["Item"]);
  assert.deepEqual(Object.keys(schema.components.parameters), ["Limit"]);
  assert.deepEqual(warnings, []);
  schema.components.schemas.Item.properties.id.type = "number";
  assert.deepEqual(document, before);
  const minimal = { openapi: "3.0.3", paths: { [selectedPath]: { get: {} } } };
  assert.deepEqual(scope(minimal).schema, { openapi: "3.0.3", servers: [{ url: "/" }], paths: minimal.paths });
});

Then("schema reports use effective servers and only required security schemes", function () {
  const document = fixture();
  const rootServer = [{ url: "https://catalog.example.invalid" }];
  const pathServer = [{ url: "https://path.example.invalid" }];
  const operationServer = [{ url: "https://operation.example.invalid" }];
  const name = "API key/~%";
  document.servers = rootServer;
  document.security = [{ [name]: [] }];
  document.components = { securitySchemes: { [name]: { type: "apiKey", name: "x-key", in: "header" }, Other: { type: "http", scheme: "bearer" } } };
  let report = scope(document);
  assert.deepEqual(report.schema.servers, rootServer);
  assert.deepEqual(report.schema.security, document.security);
  assert.deepEqual(Object.keys(report.schema.components.securitySchemes), [name]);
  assert.deepEqual(report.warnings, []);
  document.paths[selectedPath].servers = pathServer;
  assert.deepEqual(scope(document).schema.servers, pathServer);
  document.paths[selectedPath].get.servers = operationServer;
  document.paths[selectedPath].get.security = [{ Other: [] }];
  report = scope(document);
  assert.deepEqual(report.schema.servers, operationServer);
  assert.deepEqual(report.schema.security, [{ Other: [] }]);
  assert.deepEqual(Object.keys(report.schema.components.securitySchemes), ["Other"]);
  document.paths[selectedPath].get.servers = [];
  document.paths[selectedPath].get.security = [];
  report = scope(document);
  assert.deepEqual(report.schema.servers, [{ url: "/" }]);
  assert.deepEqual(report.schema.security, []);
  assert.equal("components" in report.schema, false);
  delete document.paths[selectedPath].get.servers;
  document.paths[selectedPath].servers = [];
  assert.deepEqual(scope(document).schema.servers, [{ url: "/" }]);
});

Then("schema reports preserve transitive escaped and cyclic references at their original pointers", function () {
  const document = fixture({ responses: response(schemaReference("A~1B~0C%20D")) });
  document.components = { schemas: {
    "A/B~C D": { type: "object", properties: { child: schemaReference("Loop"), choice: { $ref: "#/components/schemas/Choices/allOf/0" } } },
    Loop: { allOf: [schemaReference("A~1B~0C%20D"), { type: "null" }] },
    Choices: { allOf: [{ type: "string" }, { type: "number" }] },
    Unused: { type: "boolean" }
  } };
  Object.defineProperty(document.components.schemas, "__proto__", { value: { type: "integer" }, enumerable: true });
  document.components.schemas.Loop.allOf.push(schemaReference("__proto__"));
  const { schema, warnings } = scope(document);
  assert.deepEqual(schema.components.schemas["A/B~C D"], document.components.schemas["A/B~C D"]);
  assert.deepEqual(schema.components.schemas.Loop, document.components.schemas.Loop);
  assert.deepEqual(schema.components.schemas.Choices, { allOf: [{ type: "string" }] });
  assert.deepEqual(Object.keys(schema.components.schemas).sort(), ["A/B~C D", "Choices", "Loop", "__proto__"].sort());
  assert.deepEqual(schema.components.schemas.__proto__, { type: "integer" });
  assert.equal(Object.getPrototypeOf(schema.components.schemas), Object.prototype);
  assert.deepEqual(warnings, []);
  assert.doesNotThrow(() => JSON.stringify(schema));
});

Then("schema traversal distinguishes real definitions from literal example and extension data", function () {
  const literal = { $ref: "#/literal-is-not-a-schema-reference" };
  const document = fixture({ responses: response(schemaReference("Item")), "x-extra": literal });
  document["x-literals"] = { nested: { payload: literal } };
  document.paths[selectedPath].get.responses[200].content["application/json"].examples = { Sample: { $ref: "#/components/examples/Sample" } };
  document.components = {
    schemas: {
      Item: {
        type: "object", properties: { example: schemaReference("Kept"), default: schemaReference("Kept"), "x-field": schemaReference("Kept"), $ref: { type: "string" }, saved: { $ref: "#/x-literals/nested/payload" } },
        example: literal, examples: [literal], default: literal, enum: [literal], const: literal, "x-extension": literal,
        discriminator: { propertyName: "kind", mapping: { thing: "#/not-followed" } }
      },
      Kept: { type: "string" }
    },
    examples: { Sample: { summary: "A literal example", value: literal } }
  };
  const { schema, warnings } = scope(document);
  assert.deepEqual(Object.keys(schema.components.schemas), ["Item", "Kept"]);
  assert.deepEqual(schema.components.schemas.Item, document.components.schemas.Item);
  assert.deepEqual(schema.components.examples, document.components.examples);
  assert.deepEqual(schema.paths[selectedPath].get["x-extra"], literal);
  assert.deepEqual(schema["x-literals"], document["x-literals"]);
  assert.deepEqual(warnings, []);
});

Then("unresolved schema references warn without fetching or expanding other operations", function () {
  const problems = [
    [19, "must be a string"],
    ["https://example.invalid/remote.json#/Thing", "External references are not fetched"],
    ["#/%ZZ", "invalid URL encoding"],
    ["#anchor", "local JSON pointer"],
    ["#/bad~2escape", "local JSON pointer"],
    ["#/missing", "not found"],
    ["#/empty/name", "not found"],
    ["#/scalar/name", "not found"],
    ["#/toString", "not found"],
    ["#/paths", "outside this report"],
    ["#/paths/~1items", "outside this report"],
    ["#/paths/~1other/get", "outside this report"],
    ["#/paths/~1items/post", "outside this report"]
  ];
  for (const [reference, reason] of problems) {
    const document = fixture({ responses: response({ allOf: [{ $ref: reference }, { $ref: reference }] }) }, { post: { operationId: "create" } });
    document.paths["/other"] = { get: {} };
    document.empty = null;
    document.scalar = "text";
    const { schema, warnings } = scope(document);
    assert.equal(warnings.length, 1, String(reference));
    assert.ok(warnings[0].includes(reason), warnings[0]);
    assert.deepEqual(Object.keys(schema.paths), [selectedPath]);
    assert.equal("post" in schema.paths[selectedPath], false);
    assert.deepEqual(schema.paths[selectedPath].get.responses, document.paths[selectedPath].get.responses);
  }
  const missingSecurity = fixture();
  missingSecurity.security = [{ Missing: [] }];
  assert.match(scope(missingSecurity).warnings[0], /securitySchemes\/Missing: .*not found/);
});

Then("operation links preserve local context and warn about external or other operation targets", function () {
  const literal = { $ref: "#/not-a-schema-reference" };
  const document = fixture({ responses: { "200": { description: "Read result", links: {
    Self: { operationRef: "#/paths/~1items/get", parameters: literal, requestBody: literal },
    Other: { operationRef: "#/paths/~1other/get" },
    External: { operationRef: "https://example.invalid/openapi.json#/paths/~1items/get" },
    Shared: { $ref: "#/components/links/Shared" }
  } } } }, { parameters: [{ name: "id", in: "query", schema: { type: "string" } }] });
  document.components = { links: { Shared: { operationRef: "#/paths/~1items/get", parameters: { id: "$response.body#/id" } } } };
  const before = structuredClone(document);
  const report = scope(document);
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.some(warning => warning.includes("outside this report")));
  assert.ok(report.warnings.some(warning => warning.includes("External references are not fetched")));
  assert.deepEqual(report.schema.components.links, document.components.links);
  assert.deepEqual(report.schema.paths[selectedPath], document.paths[selectedPath]);
  assert.deepEqual(document, before);
  document.paths[selectedPath].get.responses[200].links.Shared = { $ref: "#/paths/~1items/parameters/0" };
  assert.equal(scope(document).warnings.length, 2);
});

Then("unavailable operation schemas fail with a useful reason", function () {
  for (const document of [
    { openapi: "3.1.0" },
    { openapi: "3.1.0", paths: null },
    { openapi: "3.1.0", paths: [] },
    { openapi: "3.1.0", paths: { [selectedPath]: "invalid" } },
    { openapi: "3.1.0", paths: { [selectedPath]: {} } },
    { openapi: "3.1.0", paths: { [selectedPath]: { get: [] } } },
    { paths: { [selectedPath]: { get: {} } } }
  ]) assert.throws(() => scope(document), /Schema unavailable.*OpenAPI operation/);
  assert.throws(() => scopeOperationSchema(fixture({}, { custom: {} }), selectedPath, "custom"), /Schema unavailable/);
  const known = operations[0];
  assert.throws(() => getOperationReport({ ...known, id: "other:listProjects" }), /source catalog is not bundled/);
  assert.throws(() => getOperationReport({ ...known, id: "demo:getProject" }), /identifier does not match/);
  assert.throws(() => getOperationReport({ ...known, path: "/missing" }), /Schema unavailable/);
  assert.throws(() => getOperationReport({ ...known, method: "POST" }), /Schema unavailable/);
  const live = operations.find(operation => operation.id === "httpbin:echoGet");
  assert.throws(() => getOperationReport({ ...live, id: "httpbin:echoPost" }), /identifier does not match/);
  assert.throws(() => getOperationReport({ ...live, id: "demo:echoGet" }), /Schema unavailable/);
  assert.throws(() => getOperationReport({ ...known, id: "httpbin:listProjects" }), /Schema unavailable/);
});
