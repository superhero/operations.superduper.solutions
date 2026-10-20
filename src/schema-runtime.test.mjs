// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { vi } from "vitest";
import { After, Before, Then } from "@cucumber/cucumber";
import * as catalogModule from "./lib/catalog.ts";
import { extractOperations, operations, publishPreparedCatalogs, updateCatalogs } from "./lib/catalog.ts";
import { bundledCatalogs, catalogs, catalogForOperation } from "./lib/catalog-registry.ts";
import { getOperationReport } from "./lib/operation-report.ts";
import { validateSchemaDocument } from "./lib/schema-documents.ts";
import { createWorkflowRequestExecution, workflowExecutionForOperation, workflowRequestUrl } from "./lib/workflow-execution.ts";
import { createOperationGraph } from "./lib/workflow-graph.ts";
import { createWorkflowRunner } from "./lib/workflow-runner.ts";
import { catalogHierarchy } from "./lib/catalog-hierarchy.ts";
import { schemaNameTree } from "./lib/schema-name-tree.ts";
import { schemaDeletionReason } from "./lib/schema-deletion.ts";

Then("schema deletion protects defaults and permits only inactive uploaded records", () => {
  for (const enabled of [true, false])
    assert.equal(schemaDeletionReason({ bundled: true, enabled }), "Default schemas cannot be deleted.");
  for (const bundled of [false, undefined]) {
    assert.equal(schemaDeletionReason({ bundled, enabled: true }), "Disable this schema before deleting it.");
    assert.equal(schemaDeletionReason({ bundled, enabled: false }), null);
  }
});

Then("the settings name tree sorts folders and leaves while preserving every schema identity", () => {
  const record = (id, name, enabled = true) => ({ id, summary: { name }, enabled,
    tags: ["Unrelated / Tag"], path: "/v1/unrelated/resource" });
  const records = [record("z", "Zebra"), record("nested", " Tools // Files / Second / "),
    record("first", "Tools / Files / First", false), record("prefix", "Tools / Files"),
    record("duplicate-b", "Tools / Files / First"), record("duplicate-a", "Tools / Files / First"),
    record("a", "Alpha"), record("special", "__proto__ / constructor"), record("blank", "///")];
  const before = structuredClone(records);
  const tree = schemaNameTree(records);
  const folders = nodes => nodes.flatMap(node => node.kind === "group" ? [node.path.join(" / "), ...folders(node.children)] : []);
  assert.deepEqual(folders(tree).sort(), ["Tools", "Tools / Files", "__proto__"].sort(), "Tags and operation URLs never create settings folders.");
  const tools = tree.find(node => node.name === "Tools");
  assert.deepEqual(tools.children.map(node => [node.kind, node.name]), [["schema", "Files"], ["group", "Files"]]);
  const files = tools.children[1];
  assert.deepEqual(files.children.map(node => [node.id, node.name]), [
    ["duplicate-a", "First"], ["duplicate-b", "First"], ["first", "First"], ["nested", "Second"],
  ]);
  assert.equal(files.children[2].record, records[2], "Disabled schemas remain reachable with their original metadata.");
  const leaves = nodes => nodes.flatMap(node => node.kind === "schema" ? [node] : leaves(node.children));
  assert.deepEqual(leaves(tree).map(node => node.id).sort(), records.map(record => record.id).sort());
  const alphabetical = nodes => {
    assert.deepEqual(nodes.map(node => node.name), nodes.map(node => node.name).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    for (const node of nodes) if (node.kind === "group") alphabetical(node.children);
  };
  alphabetical(tree);
  assert.deepEqual(schemaNameTree([...records].reverse()), tree, "Input order cannot change the alphabetical tree.");
  const renamed = schemaNameTree(records.map(item => item.id === "nested" ? record(item.id, "Moved / Second") : item));
  assert.deepEqual(folders(renamed).sort(), ["Moved", "Tools", "Tools / Files", "__proto__"].sort());
  assert.equal(renamed.find(node => node.name === "Tools").id, tools.id, "Unchanged folder paths keep stable IDs.");
  assert.equal(leaves(renamed).find(node => node.id === "nested").name, "Second");
  assert.deepEqual(folders(schemaNameTree([record("only", "Plain")])), [], "Removed prefixes leave no stale folders.");
  assert.deepEqual(records, before, "Grouping never mutates stored names, order or enablement.");
  assert.deepEqual(schemaNameTree([]), []);
  const prefixFirst = schemaNameTree([record("prefix-first", "Tools"), record("nested-last", "Tools / Child")]);
  assert.deepEqual(prefixFirst.map(node => [node.kind, node.name]), [["schema", "Tools"], ["group", "Tools"]],
    "A schema sharing a folder name keeps its own row before the folder, regardless of insertion order.");
});

Then("slash-separated schema names form ordered groups without changing their sources", () => {
  const category = { id: "compute:tag", name: "Instances / actions", description: "", operationIds: ["compute:read"] };
  const plain = { id: "plain", name: "Plain", description: "", operationIds: ["plain:read"] };
  const sources = [plain,
    { id: "compute", name: "Google / Cloud / Compute", description: "Compute API", children: [category] },
    { id: "storage", name: "Google / Cloud / Storage", description: "", operationIds: ["storage:read"] },
    { id: "gemini", name: " Google / Gemini // Interactions / ", description: "", operationIds: ["gemini:read"] },
    { id: "plain-copy", name: "Plain", description: "", operationIds: ["plain-copy:read"] },
    { id: "blank", name: "///", description: "", operationIds: ["blank:read"] }];
  const before = structuredClone(sources);
  const groups = catalogHierarchy(sources);
  assert.deepEqual(groups.map(group => group.name), ["Plain", "Google", "Plain", "///"]);
  assert.equal(groups[0], plain);
  assert.equal(groups[2], sources[4], "Plain duplicate labels retain their own rows and saved positions.");
  assert.deepEqual(groups[1].children.map(group => group.name), ["Cloud", "Gemini"]);
  const cloud = groups[1].children[0];
  assert.deepEqual(cloud.children.map(group => [group.id, group.name]), [["compute", "Compute"], ["storage", "Storage"]]);
  assert.equal(cloud.children[0].children[0], category, "Operation categories are not split by schema naming rules.");
  assert.equal(cloud.children[0].description, "Compute API");
  assert.deepEqual(groups[1].children[1].children[0].operationIds, ["gemini:read"]);
  assert.deepEqual(sources, before);
  assert.deepEqual(catalogHierarchy([]), []);
});

Then("schema name groups retain prefix schemas and duplicate labels independently", () => {
  const sources = [
    { id: "atlassian", name: "Atlassian", description: "", operationIds: ["atlassian:read"] },
    { id: "v1", name: "Atlassian / Confluence / Cloud / v1", description: "", operationIds: ["v1:read"] },
    { id: "cloud", name: "Atlassian / Confluence / Cloud", description: "", children: [
      { id: "cloud:tag", name: "Pages", description: "", operationIds: ["cloud:read"] }] },
    { id: "tags", name: "Atlassian / Marketplace / Product Tags", description: "", operationIds: ["tags:read"] },
    { id: "market", name: "Atlassian / Marketplace", description: "", operationIds: ["market:read"] },
    { id: "copy-a", name: "Local / Duplicate", description: "", operationIds: ["a:read"] },
    { id: "copy-b", name: "Local / Duplicate", description: "", operationIds: ["b:read"] },
  ];
  const groups = catalogHierarchy(sources);
  const cloud = groups[0].children[0].children[0];
  assert.equal(cloud.id, "cloud");
  assert.deepEqual(cloud.children.map(group => group.id), ["cloud:tag", "v1"]);
  const market = groups[0].children[1];
  assert.equal(market.id, "market");
  assert.deepEqual(market.operationIds, ["market:read"]);
  assert.deepEqual(market.children.map(group => group.id), ["tags"]);
  assert.deepEqual(groups[1].children[0].children.map(group => group.id), ["copy-a", "copy-b"]);
  const ids = group => [...(group.operationIds ?? []), ...(group.children ?? []).flatMap(ids)];
  assert.deepEqual(groups.flatMap(ids).sort(), sources.flatMap(ids).sort(), "Each operation remains reachable exactly once.");
});

Then("schema name grouping follows current labels and order without retaining removed groups", () => {
  const compute = { id: "compute", name: "Google / Cloud / Compute", description: "", operationIds: ["compute:read"] };
  const storage = { id: "storage", name: "Google / Cloud / Storage", description: "", operationIds: ["storage:read"] };
  const first = catalogHierarchy([compute, storage]);
  const reordered = catalogHierarchy([storage, compute]);
  assert.equal(first[0].id, reordered[0].id);
  assert.equal(first[0].children[0].id, reordered[0].children[0].id);
  assert.deepEqual(reordered[0].children[0].children.map(group => group.id), ["storage", "compute"]);
  const renamed = catalogHierarchy([{ ...storage, name: "My API" }, { ...compute, name: "Other / Compute" }]);
  assert.deepEqual(renamed.map(group => group.name), ["My API", "Other"]);
  assert.equal(renamed[1].children[0].id, "compute");
  assert.equal(catalogHierarchy([compute])[0].id, first[0].id);
  assert.deepEqual(catalogHierarchy([{ ...storage, name: "__proto__ / constructor" }])[0].children[0].name, "constructor");
});

const response = { description: "Success", content: { "application/json": { schema: { type: "object" } } } };
const fixture = (operation = {}, item = {}) => ({
  openapi: "3.1.0", info: { title: "Registered service", version: "1" },
  servers: [{ url: "https://api.example.test/v1" }],
  paths: { "/items": { ...item, get: { operationId: "read", responses: { 200: response }, ...operation } } },
});

function catalog(document = fixture(), id = "registered") {
  const validated = validateSchemaDocument(document, id);
  return { id, file: `${id}.json`, name: validated.name, document: validated.document, groups: validated.groups,
    execution: { kind: "http", origin: validated.serverUrl } };
}

function register(document = fixture(), id = "registered") {
  const result = catalog(document, id);
  updateCatalogs([...bundledCatalogs, result]);
  return result;
}

function workflow(operation, source) {
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "registered-node", source);
  return { version: 3, id: "runtime-test", name: "Registered workflow", ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
}

Before({ tags: "@schema-runtime" }, function () {
  this.schemaRuntimeCatalogs = catalogs;
});

After({ tags: "@schema-runtime" }, function () {
  updateCatalogs(this.schemaRuntimeCatalogs);
});

Then("schema validation normalizes a non-Error failure from operation extraction", () => {
  // Keep the fault injection in the same transformed module graph. Combining
  // native Node and Vite byte offsets for this file corrupts V8 coverage maps.
  const original = catalogModule.extractOperations;
  const extraction = vi.spyOn(catalogModule, "extractOperations").mockImplementation(() => {
    throw "Operation extraction failed";
  });
  try {
    assert.throws(() => validateSchemaDocument(fixture(), "test"),
      { message: "Invalid OpenAPI document: Operation extraction failed" });
    assert.equal(extraction.mock.calls.length, 1);
  } finally {
    extraction.mockRestore();
  }
  assert.equal(catalogModule.extractOperations, original);
  assert.equal(validateSchemaDocument(fixture(), "restored").operations[0].id, "restored:read");
});

Then("HTTP execution retains server base paths and resolves operation and path server overrides", async () => {
  const requests = [];
  const executor = createWorkflowRequestExecution(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ accepted: true });
  });
  const document = fixture();
  document.paths["/path"] = { servers: [{ url: "https://path.example.test/root/" }],
    get: { operationId: "path", responses: { 200: response } } };
  document.paths["/operation"] = { servers: [{ url: "https://path.example.test/root" }],
    get: { operationId: "operation", responses: { 200: response }, servers: [{
      url: "https://{region}.example.test/{version}",
      variables: { region: { default: "eu", enum: ["eu", "us"] }, version: { default: "v2" } },
    }] } };
  document.paths["/relative"] = { get: { operationId: "relative", responses: { 200: response }, servers: [{ url: "/v3" }] } };
  register(document);
  for (const id of ["read", "path", "operation", "relative"])
    await executor.execute(operations.find(operation => operation.id === `registered:${id}`), {});
  assert.deepEqual(requests.map(request => request.url), [
    "https://api.example.test/v1/items", "https://path.example.test/root/path",
    "https://eu.example.test/v2/operation", "https://api.example.test/v3/relative",
  ]);
  assert.deepEqual(workflowExecutionForOperation("registered:operation"), { kind: "http", origin: "https://eu.example.test/v2" });
  assert.ok(requests.every(request => request.options.credentials === "omit" && request.options.redirect === "error"));
});

Then("request URLs reject host changes and traversal, retain encoded path values, and omit undefined queries", () => {
  const request = { method: "GET", path: "/items/a%2Fb", query: {
    omitted: undefined, repeated: ["one", undefined, "two"], empty: null, disabled: false,
  } };
  assert.equal(workflowRequestUrl(request, "https://api.example.test/v1/"),
    "https://api.example.test/v1/items/a%2Fb?repeated=one&repeated=two&empty=null&disabled=false");
  assert.equal(workflowRequestUrl({ method: "GET", path: "/items/%3Cvalue%3E", query: {} }, "https://api.example.test/v1"),
    "https://api.example.test/v1/items/%3Cvalue%3E");
  for (const path of ["//another.example/items", "/\\another.example/items", "/items\\other", "https://another.example/items",
    "/../items", "/%2e%2E/items", "/items/./more", "/items?changed=true", "/items#fragment", "/items\nmore"])
    assert.throws(() => workflowRequestUrl({ ...request, path }, "https://api.example.test/v1"), /operation path/);
  for (const server of ["file:///local", "https://user:secret@example.test"])
    assert.throws(() => workflowRequestUrl(request, server), /HTTP or HTTPS URL without credentials/);
});

Then("cached server placeholders are rejected before fetching while configured and encoded URLs stay intact", async () => {
  const source = catalog();
  const canonical = extractOperations(source.document, source.id)[0];
  const sourceIdentity = "cached-server-placeholders";
  publishPreparedCatalogs([{ catalog: source, operations: [{ ...canonical, deferred: true }], sourceIdentity }]);
  const requests = [];
  const executor = createWorkflowRequestExecution(async url => { requests.push(url); return Response.json({ accepted: true }); });
  const request = { method: "GET", path: "/items", query: {} };
  for (const origin of ["https://api.example.test/bot<bot_token>", "https://api.example.test/bot%3Cbot_token%3E",
    "https://api.example.test/{version}", "https://api.example.test/%7bversion%7d"]) {
    assert.throws(() => workflowRequestUrl(request, origin), /still contains a placeholder/);
    catalogModule.installOperationModel({ operation: canonical, document: source.document, origin, sourceIdentity, bytes: 1 });
    await assert.rejects(() => executor.execute(canonical, {}), /still contains a placeholder/);
  }
  assert.deepEqual(requests, [], "An encoded placeholder must never become a network destination.");
  for (const origin of ["https://api.example.test/bot123456:sample-token", "https://api.example.test/teams/acme%20ops/%E2%82%AC"]) {
    catalogModule.installOperationModel({ operation: canonical, document: source.document, origin, sourceIdentity, bytes: 1 });
    await executor.execute(canonical, {});
  }
  assert.deepEqual(requests, ["https://api.example.test/bot123456:sample-token/items", "https://api.example.test/teams/acme%20ops/%E2%82%AC/items"]);
});

Then("reports support generated identifiers and referenced path items without leaking other operations", async () => {
  const document = fixture();
  document.paths["/items"] = { $ref: "#/components/pathItems/Items" };
  document.components = { pathItems: { Items: {
    servers: [{ url: "https://referenced.example.test/service" }],
    parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
    get: { responses: { 200: { description: "Items", content: { "application/json": {
      schema: { $ref: "#/components/schemas/Items" },
    } } } } },
    post: { operationId: "create", responses: { 200: response } },
  } }, schemas: { Items: { type: "array", items: { type: "string" } }, Unused: { type: "boolean" } } };
  register(document);
  const operation = operations.find(operation => operation.id === "registered:GET /items");
  const report = getOperationReport(operation);
  assert.equal(report.operationId, "GET /items");
  assert.equal(report.summary, "GET /items");
  assert.equal(report.description, "");
  assert.deepEqual(report.warnings, []);
  assert.equal(report.groups.at(-1).name, "Operations");
  assert.equal(report.schema.paths["/items"].parameters[0].name, "limit");
  assert.equal(Object.hasOwn(report.schema.paths["/items"], "post"), false);
  assert.deepEqual(Object.keys(report.schema.components.schemas), ["Items"]);
  const requests = [];
  const executor = createWorkflowRequestExecution(async url => { requests.push(url); return Response.json([]); });
  await executor.execute(operation, { "query:limit": "2" });
  assert.deepEqual(requests, ["https://referenced.example.test/service/items?limit=2"]);
});

Then("catalog changes immediately update reports, runners, and existing executors", async () => {
  const requests = [];
  const executor = createWorkflowRequestExecution(async url => { requests.push(url); return Response.json({}); });
  const source = register();
  const operation = operations.find(operation => operation.id === "registered:read");
  const saved = workflow(operation, source.document);
  assert.equal(createWorkflowRunner(saved, undefined, executor).next().operation.id, operation.id);
  assert.equal(catalogForOperation(operation.id), source);
  assert.equal(catalogForOperation("registeredish:read"), undefined);
  assert.equal(getOperationReport(operation).catalog.title, "Registered service");
  await executor.execute(operation, {});

  const next = fixture();
  next.info.title = "Updated service";
  next.servers = [{ url: "https://updated.example.test/v2" }];
  register(next);
  assert.equal(getOperationReport(operation).catalog.title, "Updated service");
  await executor.execute(operation, {});
  assert.deepEqual(requests, ["https://api.example.test/v1/items", "https://updated.example.test/v2/items"]);

  const renamed = fixture();
  renamed.paths["/moved"] = renamed.paths["/items"];
  delete renamed.paths["/items"];
  register(renamed);
  assert.throws(() => createWorkflowRunner(saved, undefined, executor).next(), /unavailable in the registered schemas/);
  await assert.rejects(() => executor.execute(operation, {}), /not available in the registered schemas/);

  updateCatalogs(bundledCatalogs);
  assert.equal(operations.some(operation => operation.id.startsWith("registered:")), false);
  assert.equal(catalogForOperation(operation.id), undefined);
  assert.throws(() => getOperationReport(operation), /source schema is not registered/);
  assert.throws(() => workflowExecutionForOperation(operation), /registered schemas/);
  assert.throws(() => createWorkflowRunner(saved, undefined, executor).next(), /registered schemas/);
  await assert.rejects(() => executor.execute(operation, {}), /registered schemas/);
  assert.equal(requests.length, 2);
});

Then("unchanged sources retain operation identity while source-only changes replace it", () => {
  const source = register();
  const original = operations.find(operation => operation.id === "registered:read");
  const bundled = operations.find(operation => operation.id === "demo:listProjects");
  updateCatalogs([...bundledCatalogs, structuredClone(source)]);
  assert.equal(operations.find(operation => operation.id === original.id), original);
  assert.equal(operations.find(operation => operation.id === bundled.id), bundled);

  updateCatalogs([...bundledCatalogs, structuredClone(source), catalog(fixture(), "unrelated")]);
  assert.equal(operations.find(operation => operation.id === original.id), original);
  assert.equal(operations.find(operation => operation.id === bundled.id), bundled);

  const changed = structuredClone(source);
  changed.document.servers = [{ url: "https://changed.example.test/v2" }];
  updateCatalogs([...bundledCatalogs, changed]);
  const replacement = operations.find(operation => operation.id === original.id);
  assert.notEqual(replacement, original);
  assert.deepEqual(replacement, original, "A server change is visible even when extracted operation fields are equal.");
  assert.equal(operations.find(operation => operation.id === bundled.id), bundled);

  updateCatalogs([...bundledCatalogs, { ...changed, file: "renamed.json" }]);
  assert.notEqual(operations.find(operation => operation.id === original.id), replacement);
});

Then("failed catalog replacements preserve both live indices", () => {
  register();
  const previousCatalogs = catalogs;
  const previousOperations = operations;
  const invalid = { ...catalog(), id: "broken", document: { openapi: "3.1.0", paths: {} } };
  assert.throws(() => updateCatalogs([...bundledCatalogs, invalid]), /no operations found/);
  assert.equal(catalogs, previousCatalogs);
  assert.equal(operations, previousOperations);
  assert.throws(() => updateCatalogs([catalog(), catalog()]), /duplicate schema identifier/);
  assert.throws(() => updateCatalogs([{ ...catalog(), id: "invalid:namespace" }]), /Invalid/);
  assert.equal(catalogs, previousCatalogs);
  assert.equal(operations, previousOperations);
});

Then("worker-prepared catalogs publish without reprocessing documents and retain unchanged operation identities", () => {
  const source = register();
  const original = operations.find(operation => operation.id === "registered:read");
  const prepare = value => ({ catalog: structuredClone(value), operations: extractOperations(value.document, value.id),
    sourceIdentity: JSON.stringify([value.file, value.document]) });
  const prepared = prepare(source);
  Object.defineProperty(prepared.catalog.document, "paths", { enumerable: true,
    get() { throw new Error("Prepared documents must not be parsed or serialized again on the UI thread."); } });
  publishPreparedCatalogs([prepared]);
  assert.equal(operations[0], original);
  assert.equal(catalogs[0], prepared.catalog);

  const expanded = prepare(source);
  const additional = { ...original, id: "registered:additional" };
  expanded.operations.push(additional);
  publishPreparedCatalogs([expanded]);
  assert.equal(operations[0], original);
  assert.equal(operations[1], additional, "A newly prepared operation must survive when no prior identity can be reused.");

  const changed = structuredClone(source);
  changed.document.servers = [{ url: "https://changed.example.test/v2" }];
  publishPreparedCatalogs([prepare(changed)]);
  assert.notEqual(operations[0], original, "Changed source fingerprints replace operation identity even when fields are unchanged.");
  assert.deepEqual(operations[0], original);
  const previousCatalogs = catalogs;
  const previousOperations = operations;
  assert.throws(() => publishPreparedCatalogs([prepare(source), prepare(source)]), /duplicate schema identifier/);
  assert.equal(catalogs, previousCatalogs);
  assert.equal(operations, previousOperations);
});
