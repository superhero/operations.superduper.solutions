// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { maxWorkflowFileSize, validateWorkflowDocument, parseWorkflowDocument } from "./lib/workflow-document.ts";
import { createOperationGraph, schemaBranches, isWorkflowConnection, removeGraphSelection, restoreDataBranch, createUtilityNode, createWorkflowGraph, addSwitchGate, updateSwitchGate, removeSwitchGate, getAdditionalPropertyTypes, addAdditionalProperty, getEditableAdditionalProperties, updateAdditionalProperty, removeAdditionalProperty } from "./lib/workflow-graph.ts";
import { numericValue, castValue, matchesSwitchGate, matchingSwitchGates, routingInputTypes, operatorsForType, gateForType,
  adaptRoutingGates, switchGateInput, workflowInterface, isValueConnection } from "./lib/workflow-utilities.ts";
import { nativeRpcOperation } from "./lib/native-rpc.ts";
import { readServiceSchema } from "./lib/service-schema-packs.ts";

Then('native graph panels preserve parameterless methods and refuse stale or mismatched property editors', async () => {
  const source = await readServiceSchema('codex'), parameterless = structuredClone(source);
  const request = parameterless.definitions.ClientRequest.oneOf.find(value => value.properties.method.enum[0] === 'account/read');
  delete request.properties.params; request.required = request.required.filter(name => name !== 'params');
  const operation = nativeRpcOperation(parameterless, 'native-fixture:account/read');
  const empty = createOperationGraph(operation, { x: 0, y: 0 }, 'empty', parameterless);
  assert.equal(empty.nodes.filter(node => node.type === 'data' && node.data.direction === 'inputs').every(node => node.data.fields.length === 0), true);
  const graph = createOperationGraph(nativeRpcOperation(source, 'native-fixture:thread/start'), { x: 0, y: 0 }, 'native', source);
  const root = group => graph.nodes.find(node => node.type === 'data' && node.id === 'native:'+encodeURIComponent(JSON.stringify([group, ''])));
  const result = root('rpc:result'), error = root('rpc:error');
  assert.ok(result && error);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, result.id, source), []);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, error.id, source), []);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, result.id, {}), []);
  const mismatched = { ...result, id: 'native:'+encodeURIComponent(JSON.stringify(['rpc:unknown', ''])) };
  assert.deepEqual(getAdditionalPropertyTypes([...graph.nodes, mismatched], mismatched.id, source), []);
});

Then('workflow imports retain Docker bindings only on their reviewed operation identity', () => {
  const binding = { host: { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) }, fingerprint: 'b'.repeat(64) };
  const document = plan();
  document.nodes[0].data = { operationId: 'docker:ContainerList', name: 'Containers', description: '', method: 'GET', path: '/containers/json', dockerBinding: binding };
  assert.deepEqual(validateWorkflowDocument(document).nodes[0].data.dockerBinding, binding);
  for (const change of [{ operationId: 'docker:ContainerDelete' }, { method: 'DELETE' }, { path: '/other' },
    { credentialBinding: { fingerprint: 'c'.repeat(64), alternative: 0, credentials: {} } }]) {
    const invalid = structuredClone(document); Object.assign(invalid.nodes[0].data, change);
    assert.throws(() => validateWorkflowDocument(invalid), /Invalid Docker native operation binding/);
  }
});

function plan() {
  const data = { operationId: "demo:listProjects", name: "List projects", description: "", method: "GET", path: "/projects" };
  return { version: 1, id: "plan-1", name: "Project review", nodes: [
    { id: "first", position: { x: 10, y: 20 }, data: { ...data } },
    { id: "second", position: { x: 200, y: 100 }, data: { ...data } }
  ], edges: [{ id: "connection", source: "first", target: "second" }],
  viewport: { x: -80, y: 12, zoom: 0.75 }, snap: true, curved: false, dashed: true };
}

const manualRoute = () => [{ x: 10, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
const staircaseRoute = length => Array.from({ length }, (_, index) => ({ x: Math.floor((index + 1) / 2), y: Math.floor(index / 2) }));

Given("a workflow connecting two instances of the same operation", function () { this.plan = plan(); });
When("that workflow is serialized and imported", function () {
  this.plan.nodes[0].selected = true;
  this.plan.nodes[0].data.unrecognized = "removed";
  this.plan.unrecognized = { nested: "removed" };
  this.imported = parseWorkflowDocument(JSON.stringify(this.plan));
});
Then("the operation identities, connections, and view settings are preserved", function () { assert.deepEqual(this.imported, plan()); });
Then("presentation-only and unrecognized data are removed", function () {
  assert.equal("selected" in this.imported.nodes[0], false);
  assert.equal("unrecognized" in this.imported.nodes[0].data, false);
  assert.equal("unrecognized" in this.imported, false);
});

const mutations = {
  "null document": () => null,
  "primitive document": () => "wrong",
  "array document": () => [],
  "old version": value => ({ ...value, version: 9 }),
  "missing nodes": value => ({ ...value, nodes: null }),
  "too many nodes": value => ({ ...value, nodes: Array(501).fill(value.nodes[0]) }),
  "missing edges": value => ({ ...value, edges: null }),
  "too many edges": value => ({ ...value, edges: Array(1001).fill(value.edges[0]) }),
  "unknown method": value => { value.nodes[0].data.method = "EXEC"; return value; },
  "nontext name": value => { value.nodes[0].data.name = 10; return value; },
  "blank name": value => { value.nodes[0].data.name = "  "; return value; },
  "long name": value => { value.nodes[0].data.name = "x".repeat(201); return value; },
  "nontext description": value => { value.nodes[0].data.description = null; return value; },
  "long description": value => { value.nodes[0].data.description = "x".repeat(4001); return value; },
  "nonnumeric position": value => { value.nodes[0].position.x = "10"; return value; },
  "infinite position": value => { value.nodes[0].position.x = Infinity; return value; },
  "oversized position": value => { value.nodes[0].position.x = 1000001; return value; },
  "missing source": value => { value.edges[0].source = "missing"; return value; },
  "missing target": value => { value.edges[0].target = "missing"; return value; },
  "duplicate node": value => { value.nodes.push(value.nodes[0]); return value; },
  "duplicate edge": value => { value.edges.push(value.edges[0]); return value; },
  "invalid zoom low": value => { value.viewport.zoom = 0; return value; },
  "invalid zoom high": value => { value.viewport.zoom = 3; return value; },
  "invalid view flag": value => ({ ...value, snap: "true" })
};

Then("invalid workflow documents are rejected for these reasons:", function (table) {
  for (const { mutation, reason } of table.hashes()) {
    assert.throws(() => validateWorkflowDocument(mutations[mutation](plan())), error => error.message.includes(reason), mutation);
  }
});
Then("malformed and oversized workflow files are rejected", function () {
  assert.throws(() => parseWorkflowDocument("not json"), SyntaxError);
  assert.throws(() => parseWorkflowDocument(" ".repeat(maxWorkflowFileSize + 1)), /smaller than 2 MB/);
});

Then("version {int} workflows preserve authored routes and leave automatic connections unchanged", function (version) {
  const automatic = { ...plan(), version };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(automatic)), automatic);
  assert.equal("manualRoute" in validateWorkflowDocument(automatic).edges[0], false);
  const authored = structuredClone(automatic);
  authored.edges[0].manualRoute = manualRoute();
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(authored)), authored);
  assert.equal(validateWorkflowDocument(authored).version, version);
});

Then("manual route validation clones points and removes duplicate and collinear points", function () {
  const document = plan();
  const points = [{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 50, y: 20 }, { x: 100, y: 20 },
    { x: 100, y: 60 }, { x: 100, y: 100 }, { x: 200, y: 100, selected: true }];
  document.edges[0].manualRoute = points;
  const before = structuredClone(document);
  const normalized = validateWorkflowDocument(document);
  const route = normalized.edges[0].manualRoute;
  assert.deepEqual(route, manualRoute());
  assert.deepEqual(document, before);
  assert.notEqual(route, points);
  for (const point of route) assert.ok(!points.includes(point));
  assert.deepEqual(validateWorkflowDocument(normalized), normalized);
  route[0].x = 11;
  assert.deepEqual(document, before);
});

Then("manual routes accept 128 points and coordinates at both allowed boundaries", function () {
  const document = plan();
  document.edges[0].manualRoute = staircaseRoute(128);
  assert.deepEqual(validateWorkflowDocument(document).edges[0].manualRoute, document.edges[0].manualRoute);
  document.edges[0].manualRoute = [{ x: -1_000_000, y: -1_000_000 }, { x: 1_000_000, y: -1_000_000 },
    { x: 1_000_000, y: 1_000_000 }];
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(document)), document);
});

const invalidManualRoutes = {
  "a null value": () => null,
  "a non-array value": () => ({}),
  "no points": () => [],
  "one point": () => [{ x: 0, y: 0 }],
  "more than 128 points": () => staircaseRoute(129),
  "too many redundant points": () => [...Array.from({ length: 128 }, () => ({ x: 0, y: 0 })), { x: 1, y: 0 }],
  "a null point": () => [null, { x: 0, y: 0 }],
  "an array point": () => [Object.assign([], { x: 0, y: 0 }), { x: 1, y: 0 }],
  "a function point": () => [Object.assign(() => {}, { x: 0, y: 0 }), { x: 1, y: 0 }],
  "a missing coordinate": () => [{ x: 0 }, { x: 1, y: 0 }],
  "a nonnumeric coordinate": () => [{ x: "0", y: 0 }, { x: 1, y: 0 }],
  "an infinite coordinate": () => [{ x: Infinity, y: 0 }, { x: 1, y: 0 }],
  "a NaN coordinate": () => [{ x: NaN, y: 0 }, { x: 1, y: 0 }],
  "a coordinate above bounds": () => [{ x: 1_000_001, y: 0 }, { x: 1, y: 0 }],
  "a coordinate below bounds": () => [{ x: -1_000_001, y: 0 }, { x: 1, y: 0 }],
  "a diagonal segment": () => [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  "a tiny diagonal segment": () => [{ x: 0, y: 0 }, { x: 1, y: 0.000001 }],
  "an immediate reversal": () => [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }],
  "only duplicate points": () => [{ x: 0, y: 0 }, { x: 0, y: 0 }],
};

Then(/^workflow validation rejects a manual route with (.+)$/, function (defect) {
  const document = plan();
  document.edges[0].manualRoute = invalidManualRoutes[defect]();
  assert.throws(() => validateWorkflowDocument(document), /Manual connection routes must contain 2 to 128 points/);
});

Then("nested workflow snapshots clone authored routes while new interface connections remain automatic", function () {
  const source = plan();
  source.edges[0].manualRoute = manualRoute();
  const outer = nestedPlan(source);
  const snapshot = outer.nodes.find(node => node.type === "workflow").data.snapshot;
  assert.deepEqual(snapshot, source);
  assert.notEqual(snapshot.edges[0].manualRoute, source.edges[0].manualRoute);
  assert.ok(outer.edges.length > 0);
  assert.ok(outer.edges.every(edge => !("manualRoute" in edge)));
  const validated = validateWorkflowDocument(outer);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(outer)), validated);
  const importedRoute = validated.nodes.find(node => node.type === "workflow").data.snapshot.edges[0].manualRoute;
  source.edges[0].manualRoute[0].x = 12;
  snapshot.edges[0].manualRoute[0].x = 14;
  assert.deepEqual(importedRoute, manualRoute());
});

function schemaFixture() {
  const operation = { id: "fixture:transform", name: "Transform project", description: "A documented visual example.",
    group: "Examples", method: "POST", path: "/transform", fields: [], bodyRequired: true,
    responseExample: { inventedFromExample: true } };
  const document = { paths: { "/transform": { post: {
    parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", description: "Project identity" } },
      { name: "limit", in: "query", schema: { type: "integer" } }],
    requestBody: { content: { "application/json": { schema: { type: "object", required: ["name"], properties: {
      name: { type: "string" }, enabled: { type: "boolean" }, details: { type: "object", properties: { active: { type: "boolean" } } }
    } } } } },
    responses: {
      "200": { content: { "application/json": { schema: { type: "object", properties: {
        project: { type: "object", properties: { id: { type: "string" }, tasks: { type: "array", items: {
          type: "object", properties: { title: { type: "string" }, estimate: { type: "number" } }
        } } } }, "a/b~c": { type: "string" }
      } } } } },
      "400": { content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } }
    }
  } } } };
  return { operation, document };
}

function richPlan() {
  const { operation, document } = schemaFixture();
  const first = createOperationGraph(operation, { x: 0, y: 0 }, "producer", document);
  const second = createOperationGraph(operation, { x: 1600, y: 0 }, "receiver", document);
  return { ...plan(), version: 2, nodes: [...first.nodes, ...second.nodes], edges: [...first.edges, ...second.edges] };
}
function panel(plan, owner, direction, field) {
  return plan.nodes.find(node => node.type === "data" && node.data.ownerId === owner && node.data.direction === direction && node.data.fields.some(row => row.label === field));
}
function mapping(plan) {
  const source = panel(plan, "producer", "outputs", "title");
  const target = panel(plan, "receiver", "inputs", "name");
  return { id: "mapping:title:name", kind: "mapping", source: source.id, target: target.id,
    sourceHandle: source.data.fields.find(field => field.label === "title").id,
    targetHandle: target.data.fields.find(field => field.label === "name").id };
}
function replaceGraph(plan, graph) { return { ...plan, ...graph }; }

Given("a documented workflow with nested objects and arrays", function () { this.rich = richPlan(); });
Then("location panels and all documented HTTP response panels have stable named field handles", function () {
  const nodes = this.rich.nodes.filter(node => node.type === "data" && node.data.ownerId === "producer");
  assert.deepEqual(nodes.slice(0, 3).map(node => node.data.label), ["Path parameters", "Query parameters", "Request body"]);
  assert.ok(nodes.some(node => node.data.label === "Response · 200"));
  assert.ok(nodes.some(node => node.data.label === "Response · 400"));
  const error = panel(this.rich, "producer", "outputs", "error").data.fields[0];
  assert.deepEqual(JSON.parse(decodeURIComponent(error.id)), ["response:400:application/json", "/body/error"]);
  const escaped = panel(this.rich, "producer", "outputs", "a/b~c").data.fields.find(field => field.label === "a/b~c");
  assert.deepEqual(JSON.parse(decodeURIComponent(escaped.id)), ["response:200:application/json", "/body/a~1b~0c"]);
  assert.ok(nodes.every(node => node.data.fields.every(field => field.id !== "value")));
  assert.equal(panel(this.rich, "producer", "inputs", "name").data.fields.find(field => field.label === "name").required, true);
  assert.equal(panel(this.rich, "producer", "inputs", "projectId").data.fields[0].description, "Project identity");
  assert.deepEqual(validateWorkflowDocument(this.rich), this.rich);
  const { operation, document } = schemaFixture();
  const relocated = createOperationGraph(operation, { x: 20, y: 60 }, "producer", document);
  assert.deepEqual(relocated.nodes.map(node => node.id), this.rich.nodes.filter(node => node.id === "producer" || node.data.ownerId === "producer").map(node => node.id));
  const branch = schemaBranches(this.rich.nodes, this.rich.edges).get("producer");
  assert.equal([...branch.values()].filter(value => value.direction === "inputs").length, 3);
  const responses = document.paths[operation.path].post.responses;
  for (const status of ["100", "300", "500", "599", "1XX", "2XX", "3XX", "4XX", "5XX", "099", "600", "6XX", "x-response"])
    responses[status] = { description: "Documented response without a body" };
  responses.default = { content: {
    "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } },
    "text/plain": { schema: { type: "string" } }
  } };
  const allResponses = createOperationGraph(operation, { x: 0, y: 0 }, "all-responses", document);
  const outputBranches = [...schemaBranches(allResponses.nodes, allResponses.edges).get("all-responses").values()]
    .filter(value => value.direction === "outputs");
  assert.deepEqual(outputBranches.map(value => value.label), [
    "Response · 100", "Response · 200", "Response · 300", "Response · 400", "Response · 500", "Response · 599",
    "Response · 1XX", "Response · 2XX", "Response · 3XX", "Response · 4XX", "Response · 5XX",
    "Response · default · application/json", "Response · default · text/plain"
  ]);
  const fallback = panel(allResponses, "all-responses", "outputs", "message").data.fields[0];
  assert.deepEqual(JSON.parse(decodeURIComponent(fallback.id)), ["response:default:application/json", "/body/message"]);
  assert.deepEqual(validateWorkflowDocument({ ...plan(), version: 2, ...allResponses }).nodes, allResponses.nodes);
});
Then("examples never invent workflow fields", function () {
  const { operation, document } = schemaFixture();
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "unknown");
  const outputs = graph.nodes.find(node => node.type === "data" && node.data.direction === "outputs");
  assert.deepEqual(outputs.data.fields, []);
  assert.match(outputs.data.notice, /not documented/);
  assert.ok(!this.rich.nodes.some(node => node.type === "data" && node.data.fields.some(field => field.label === "inventedFromExample")));
  document.paths[operation.path].post.responses["200"].content["application/json"].schema = { type: "object", example: { invented: "x" } };
  const exampleOnly = createOperationGraph(operation, { x: 0, y: 0 }, "example", document);
  const output = exampleOnly.nodes.find(node => node.type === "data" && node.data.label === "Response body");
  assert.deepEqual(output.data.fields, []);
  assert.match(output.data.notice, /No named properties/);
});

Then("response outputs retain status messages body shapes and referenced header contracts", function () {
  const { operation, document } = schemaFixture();
  document.components = {
    headers: { Limit: { description: "Requests remaining", schema: { type: "integer" } } },
    schemas: { Payload: { type: "object", title: "Server payload", properties: { id: { type: "string" } } } },
    responses: { Success: { description: "Successful response", headers: {
      "X-Limit": { $ref: "#/components/headers/Limit" },
      "X-Trace": { schema: { type: "string" }, description: "Request trace", required: true },
      "X-Unknown": { $ref: "#/missing/header" }
    }, content: { "application/json": { schema: { $ref: "#/components/schemas/Payload" } } } } }
  };
  document.paths[operation.path].post.responses = {
    "200": { $ref: "#/components/responses/Success" },
    "201": { description: "Created", content: { "text/plain": { schema: { type: "string" } } } },
    "202": { description: "Accepted", content: { "application/json": {} } },
    "204": { description: "No content" },
    "206": { description: "Partial", content: { "application/json": { schema: { type: "array", items: { type: "integer" } } } } },
    "500": { $ref: "#/missing/response" }
  };
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "response", document);
  const root = status => graph.nodes.find(node => node.type === "data" && node.data.label === `Response · ${status}`);
  assert.deepEqual(root("200").data.fields.map(field => [field.label, field.type]), [
    ["Status", "Integer"], ["Status message", "Text"], ["Response body", "Object"], ["Response headers", "Object"]
  ]);
  assert.deepEqual(root("200").data.fields.map(field => JSON.parse(decodeURIComponent(field.id))),
    ["status", "statusText", "body", "headers"].map(name => ["response:200:application/json", `/${name}`]));
  assert.equal(root("200").data.fields[0].description, "Successful response");
  assert.equal(root("201").data.fields[2].type, "Text");
  assert.equal(root("202").data.fields[2].type, "Unknown");
  assert.equal(root("202").data.fields[2].connectable, false);
  assert.equal(root("204").data.fields[2].type, "Null");
  assert.equal(root("206").data.fields[2].type, "Array");
  assert.equal(root("500").data.fields[2].type, "Unknown");
  const branches = schemaBranches(graph.nodes, graph.edges);
  const body = graph.nodes.find(node => node.id === branches.get(root("200").id).get(root("200").data.fields[2].id).childId);
  assert.equal(body.data.label, "Response body");
  assert.deepEqual(body.data.fields.map(field => field.label), ["id"]);
  const headers = graph.nodes.find(node => node.id === branches.get(root("200").id).get(root("200").data.fields[3].id).childId);
  assert.deepEqual(headers.data.fields.map(field => [field.label, field.type]), [["X-Limit", "Integer"], ["X-Trace", "Text"], ["X-Unknown", "Unknown"]]);
  assert.equal(headers.data.fields[0].description, "Requests remaining");
  assert.equal(headers.data.fields[1].required, true);
  assert.equal(headers.data.fields[2].connectable, false);
  assert.deepEqual(JSON.parse(decodeURIComponent(headers.data.fields[0].id)), ["response:200:application/json", "/headers/X-Limit"]);
  importedGraph(graph);
});

Then("response body and header properties remain editable without changing legacy body identities", function () {
  const { graph: original, node: body, document } = additionalFixture({ type: "object" });
  const root = original.nodes.find(node => node.type === "data" && node.data.label === "Response · 200");
  assert.deepEqual(getAdditionalPropertyTypes(original.nodes, root.id, document), []);
  let graph = addAdditionalProperty(original.nodes, original.edges, body.id, "custom", "Object", document);
  const custom = graph.nodes.find(node => node.type === "data" && node.data.label === "custom");
  graph = addAdditionalProperty(graph.nodes, graph.edges, custom.id, "value", "Text", document);
  assert.deepEqual(JSON.parse(decodeURIComponent(graph.nodes.find(node => node.id === custom.id).data.fields[0].id)),
    ["response:200:application/json", "/body/custom/value"]);
  const headers = graph.nodes.find(node => node.id === `additional:${encodeURIComponent(JSON.stringify(["response:200:application/json", "/headers"]))}`);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, headers.id, document), ["Text"]);
  graph = addAdditionalProperty(graph.nodes, graph.edges, headers.id, "X-Custom", "Text", document);
  assert.deepEqual(JSON.parse(decodeURIComponent(graph.nodes.find(node => node.id === headers.id).data.fields[0].id)),
    ["response:200:application/json", "/headers/X-Custom"]);
  importedGraph(graph);
  const owner = original.nodes[0];
  const legacy = { id: `${owner.id}:${encodeURIComponent(JSON.stringify(["output:200:application/json", ""]))}`,
    type: "data", position: { x: 300, y: 0 }, data: { ownerId: owner.id, direction: "outputs", label: "Response · 200", fields: [] } };
  const old = addAdditionalProperty([owner, legacy], [{ id: `schema:${legacy.id}`, kind: "schema", source: owner.id,
    target: legacy.id, sourceHandle: `schema:${legacy.id}`, targetHandle: "value" }], legacy.id, "original", "Text", document);
  assert.deepEqual(JSON.parse(decodeURIComponent(old.nodes[1].data.fields[0].id)), ["output:200:application/json", "/original"]);
  importedGraph(old);
});

Then("open response header objects add only wire text unless a property schema declares another type", function () {
  for (const [additional, type] of [[undefined, "Text"], [true, "Text"], [{}, "Text"],
    [{ $ref: "#/components/schemas/Free" }, "Text"], [{ type: "integer" }, "Integer"],
    [{ $ref: "#/components/schemas/Count" }, "Integer"]]) {
    const { operation, document } = schemaFixture();
    document.components = { schemas: { Free: {}, Count: { type: "integer" } } };
    document.paths[operation.path].post.responses[200].headers = { "X-Object": { schema: {
      type: "object", ...(additional === undefined ? {} : { additionalProperties: additional })
    } } };
    let graph = createOperationGraph(operation, { x: 0, y: 0 }, "headers", document);
    const node = graph.nodes.find(node => node.type === "data" && node.data.label === "X-Object");
    assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, node.id, document), [type]);
    graph = addAdditionalProperty(graph.nodes, graph.edges, node.id, "value", type, document);
    const property = getEditableAdditionalProperties(graph.nodes, node.id, document)[0];
    assert.deepEqual(property.types, [type]);
    assert.throws(() => addAdditionalProperty(graph.nodes, graph.edges, node.id, "nested", "Object", document), /not permitted/);
    assert.throws(() => updateAdditionalProperty(graph.nodes, graph.edges, node.id, property.fieldId, "value",
      type === "Text" ? "Integer" : "Text", document), /not permitted/);
    graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, property.fieldId, "renamed", type, document);
    assert.equal(graph.nodes.find(item => item.id === node.id).data.fields[0].type, type);
    importedGraph(graph);
  }
});
When("a named output field is mapped to an input field", function () {
  this.mapping = mapping(this.rich);
  assert.equal(isWorkflowConnection(this.mapping, this.rich.nodes, this.rich.edges), true);
  this.rich.edges.push(this.mapping);
});
When("a separate schema branch is hidden", function () {
  const child = panel(this.rich, "producer", "inputs", "active");
  this.rich = replaceGraph(this.rich, removeGraphSelection({ nodes: [{ id: child.id }], edges: [] }, this.rich.nodes, this.rich.edges));
});
Then("the version 2 workflow survives export and import with its handles and branch state", function () {
  this.rich.nodes[0].selected = true;
  this.rich.nodes[0].width = 160;
  this.rich.nodes[0].measured = { width: 160, height: 100 };
  this.rich.edges[0].selected = true;
  this.richImported = parseWorkflowDocument(JSON.stringify(this.rich));
  assert.equal(this.richImported.version, 2);
  assert.ok(this.richImported.nodes.some(node => node.hidden));
  assert.ok(this.richImported.edges.some(edge => edge.detached && edge.hidden));
  assert.deepEqual(this.richImported.edges.find(edge => edge.kind === "mapping"), this.mapping);
});
Then("runtime selection and dimensions are not persisted", function () {
  assert.ok(this.richImported.nodes.every(node => !Object.hasOwn(node, "selected") && !Object.hasOwn(node, "width") && !Object.hasOwn(node, "measured")));
  assert.ok(this.richImported.edges.every(edge => !Object.hasOwn(edge, "selected")));
});
Then("only visible output-to-input named field connections are accepted", function () {
  const candidate = mapping(this.rich);
  assert.equal(isWorkflowConnection(candidate, this.rich.nodes, this.rich.edges), true);
  for (const change of [{ target: "missing" }, { source: "missing" }, { target: candidate.source },
    { source: candidate.target, target: candidate.source, sourceHandle: candidate.targetHandle, targetHandle: candidate.sourceHandle },
    { source: "producer" }, { sourceHandle: "not-a-field" }, { targetHandle: "not-a-field" }])
    assert.equal(isWorkflowConnection({ ...candidate, ...change }, this.rich.nodes, this.rich.edges), false);
  const source = panel(this.rich, "producer", "outputs", "estimate");
  const target = panel(this.rich, "receiver", "inputs", "enabled");
  assert.equal(isWorkflowConnection({ source: source.id, target: target.id,
    sourceHandle: source.data.fields.find(field => field.label === "estimate").id,
    targetHandle: target.data.fields.find(field => field.label === "enabled").id }, this.rich.nodes, this.rich.edges), false);
  const hidden = this.rich.nodes.map(node => node.id === candidate.source ? { ...node, hidden: true } : node);
  assert.equal(isWorkflowConnection(candidate, hidden, this.rich.edges), false);
  assert.equal(isWorkflowConnection({ source: "producer", target: "receiver" }, this.rich.nodes, this.rich.edges), false);
});
Then("duplicate mappings and structural header connections are rejected", function () {
  const candidate = mapping(this.rich);
  assert.equal(isWorkflowConnection(candidate, this.rich.nodes, [...this.rich.edges, candidate]), false);
  assert.equal(isWorkflowConnection({ ...candidate, sourceHandle: "value" }, this.rich.nodes, this.rich.edges), false);
  assert.equal(isWorkflowConnection({ ...candidate, targetHandle: "value" }, this.rich.nodes, this.rich.edges), false);
  assert.equal(isWorkflowConnection({ ...candidate, sourceHandle: null, targetHandle: null }, this.rich.nodes, this.rich.edges), false);
});
When("a nested schema connection is removed", function () {
  const parent = panel(this.rich, "producer", "outputs", "project");
  this.branch = [...schemaBranches(this.rich.nodes, this.rich.edges).get(parent.id).values()][0];
  this.rich.edges.find(edge => edge.id === `schema:${this.branch.childId}`).manualRoute = manualRoute();
  this.beforeRemoval = structuredClone(this.rich);
  this.rich = replaceGraph(this.rich, removeGraphSelection({ nodes: [], edges: [{ id: `schema:${this.branch.childId}` }] }, this.rich.nodes, this.rich.edges));
});
Then("that branch and its descendants are hidden while their topology is retained", function () {
  assert.equal(this.rich.nodes.length, this.beforeRemoval.nodes.length);
  assert.equal(this.rich.edges.length, this.beforeRemoval.edges.length);
  assert.equal(this.rich.nodes.find(node => node.id === this.branch.childId).hidden, true);
  assert.equal(panel(this.rich, "producer", "outputs", "title").hidden, true);
  assert.equal(this.rich.edges.find(edge => edge.id === `schema:${this.branch.childId}`).detached, true);
  assert.deepEqual(this.rich.edges.find(edge => edge.id === `schema:${this.branch.childId}`).manualRoute, manualRoute());
  assert.deepEqual(validateWorkflowDocument(this.rich), this.rich);
  const nested = panel(this.rich, "producer", "outputs", "title");
  assert.deepEqual(restoreDataBranch(nested.id, this.rich.nodes, this.rich.edges), { nodes: this.rich.nodes, edges: this.rich.edges });
});
When("that data branch is restored", function () {
  this.rich = replaceGraph(this.rich, restoreDataBranch(this.branch.childId, this.rich.nodes, this.rich.edges));
});
Then("all its schema panels and connections are visible again", function () {
  assert.ok(this.rich.nodes.every(node => !node.hidden));
  assert.ok(this.rich.edges.every(edge => !edge.hidden && !edge.detached));
  assert.deepEqual(this.rich, this.beforeRemoval);
  assert.deepEqual(validateWorkflowDocument(this.rich), this.rich);
});
When("the producing operation is deleted", function () {
  this.rich = replaceGraph(this.rich, removeGraphSelection({ nodes: [{ id: "producer" }], edges: [] }, this.rich.nodes, this.rich.edges));
});
Then("only the receiving operation and its panels remain", function () {
  assert.ok(this.rich.nodes.every(node => node.id === "receiver" || node.data.ownerId === "receiver"));
  assert.ok(!this.rich.edges.some(edge => edge.kind === "mapping"));
  assert.deepEqual(validateWorkflowDocument(this.rich), this.rich);
});
When("that field mapping is removed", function () {
  this.beforeRemoval = structuredClone(this.rich);
  this.rich = replaceGraph(this.rich, removeGraphSelection({ nodes: [], edges: [this.mapping] }, this.rich.nodes, this.rich.edges));
});
Then("the input panel and all schema branches remain visible", function () {
  assert.deepEqual(this.rich.nodes, this.beforeRemoval.nodes);
  assert.deepEqual(this.rich.edges, this.beforeRemoval.edges.filter(edge => edge.kind !== "mapping"));
});
When("a documented operation is added to the legacy workflow", function () {
  const { operation, document } = schemaFixture();
  const graph = createOperationGraph(operation, { x: 600, y: 0 }, "added", document);
  this.rich = { ...this.plan, version: 2, nodes: [...this.plan.nodes, ...graph.nodes], edges: [...this.plan.edges, ...graph.edges] };
});
Then("its legacy connection is preserved without becoming a field mapping", function () {
  const result = parseWorkflowDocument(JSON.stringify(this.rich));
  assert.deepEqual(result.edges[0], this.plan.edges[0]);
  assert.equal(result.edges[0].kind, undefined);
  assert.equal(isWorkflowConnection({ source: "second", target: "first" }, result.nodes, result.edges), true);
  assert.equal(isWorkflowConnection(this.plan.edges[0], result.nodes, result.edges), false);
});

const richMutations = {
  "missing owner": p => { p.nodes.find(n => n.type === "data").data.ownerId = "missing"; },
  "data owner": p => { const data = p.nodes.find(n => n.type === "data"); data.data.ownerId = data.id; },
  "unsupported node": p => { p.nodes[0].type = "switch"; },
  "unsupported edge": p => { p.edges[0].kind = "cast"; },
  "unsupported direction": p => { p.nodes.find(n => n.type === "data").data.direction = "both"; },
  "unsupported field type": p => { p.nodes.find(n => n.type === "data").data.fields[0].type = "Anything"; },
  "duplicate field": p => { const data = p.nodes.find(n => n.type === "data").data; data.fields.push(data.fields[0]); },
  "unknown connectable field": p => { p.nodes.find(n => n.type === "data").data.fields[0].type = "Unknown"; },
  "structural field id": p => { p.nodes.find(n => n.type === "data").data.fields[0].id = "value"; },
  "too many fields": p => { const data = p.nodes.find(n => n.type === "data").data; data.fields = Array(201).fill(data.fields[0]); },
  "bad root handle": p => { p.edges[0].targetHandle = "missing"; },
  "bad nested handle": p => { const child = panel(p, "producer", "inputs", "active"); p.edges.find(edge => edge.id === `schema:${child.id}`).targetHandle = "missing"; },
  "missing attachment": p => { p.edges.shift(); },
  "cyclic ancestry": p => {
    const parent = panel(p, "producer", "outputs", "project");
    const descendant = panel(p, "producer", "outputs", "tasks");
    const field = { id: "cycle-field", label: "Cycle", type: "Object", description: "", required: false, connectable: true };
    descendant.data.fields.push(field);
    const edge = p.edges.find(edge => edge.id === `schema:${parent.id}`);
    edge.source = descendant.id; edge.sourceHandle = field.id;
  },
  "mismatched visibility": p => { p.nodes.find(n => n.type === "data").hidden = true; },
  "unknown mapping handle": p => { p.edges.push({ ...mapping(p), sourceHandle: "missing" }); },
  "reversed mapping": p => { const edge = mapping(p); p.edges.push({ ...edge, source: edge.target, target: edge.source, sourceHandle: edge.targetHandle, targetHandle: edge.sourceHandle }); },
  "duplicate mapping": p => { const edge = mapping(p); p.edges.push(edge, { ...edge, id: "duplicate-mapping" }); },
  "untyped data connection": p => { const edge = mapping(p); delete edge.kind; p.edges.push(edge); },
  "legacy rich source": p => {
    p.nodes.push({ ...structuredClone(p.nodes[0]), id: "legacy" });
    p.edges.push({ id: "legacy-connection", source: "producer", target: "legacy" });
  },
  "legacy rich target": p => {
    p.nodes.push({ ...structuredClone(p.nodes[0]), id: "legacy" });
    p.edges.push({ id: "legacy-connection", source: "legacy", target: "receiver" });
  }
};
Then("invalid rich workflow documents are rejected for these reasons:", function (table) {
  for (const { mutation, reason } of table.hashes()) {
    const document = structuredClone(this.rich);
    richMutations[mutation](document);
    assert.throws(() => validateWorkflowDocument(document), error => error.message.includes(reason), mutation);
  }
});
Then("missing, alternative, recursive, and unsupported schemas display notices without guessed handles", function () {
  const { operation, document } = schemaFixture();
  const schemas = [undefined, { oneOf: [{ type: "string" }, { type: "number" }] }, { $ref: "https://invalid.example/schema" },
    { type: "array", prefixItems: [{ type: "string" }] }, { type: "object" }, { type: "array" },
    { $ref: "#/components/schemas/Recursive" }, { type: "object", properties: { unknown: {} } }];
  document.components = { schemas: { Recursive: { type: "object", properties: { again: { $ref: "#/components/schemas/Recursive" } } } } };
  for (const schema of schemas) {
    document.paths[operation.path].post.responses["200"].content["application/json"].schema = schema;
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, "notice", document);
    const response = graph.nodes.find(node => node.type === "data" && node.data.label === "Response · 200");
    const branch = new Set([response.id]);
    for (const id of branch)
      for (const edge of graph.edges.filter(edge => edge.kind === "schema" && edge.source === id)) branch.add(edge.target);
    const outputs = graph.nodes.filter(node => branch.has(node.id));
    assert.ok(outputs.some(node => node.data.notice));
    assert.ok(outputs.filter(node => node.id !== response.id).every(node => node.data.fields.filter(field => JSON.parse(decodeURIComponent(field.id))[1].startsWith("/body"))
      .every(field => !field.connectable)));
    const error = panel(graph, "notice", "outputs", "error").data.fields[0];
    assert.equal(error.connectable, true);
    assert.equal(error.type, "Text");
    validateWorkflowDocument({ ...plan(), version: 2, ...graph });
  }
});

Then("deep, wide, and large schema trees stay within workflow document limits", function () {
  const scalar = { type: "string" };
  const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`field${i}`, scalar])) };
  const large = { type: "object", properties: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`group${i}`, wide])) };
  const branchy = { type: "object", properties: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`group${i}`, { type: "object", properties: { nested: { type: "object" } } }])) };
  let deep = scalar;
  for (let index = 0; index < 16; index++) deep = { type: "object", properties: { nested: deep } };
  const long = { type: "object", properties: { ["long".repeat(150)]: scalar } };
  for (const schema of [wide, large, branchy, deep, long]) {
    const { operation, document } = schemaFixture();
    document.paths[operation.path].post.responses["200"].content["application/json"].schema = schema;
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, "bounded", document);
    assert.ok(graph.nodes.length <= 500);
    assert.ok(graph.nodes.some(node => node.type === "data" && node.data.notice?.includes("not expanded")));
    validateWorkflowDocument({ ...plan(), version: 2, ...graph });
  }
});
Then("parameter overrides, scalar responses, and unavailable representations remain explicit", function () {
  const { operation, document } = schemaFixture();
  const source = document.paths[operation.path].post;
  document.components = { schemas: { Scalar: { type: "integer" }, Unknown: {} } };
  document.paths[operation.path].parameters = [{ name: "limit", in: "query", schema: { type: "string" } },
    { name: "bad", in: "invalid", schema: { type: "string" } }];
  source.parameters.push({ name: "ignored", in: "cookie", schema: { type: "string", readOnly: true } });
  source.requestBody = {};
  source.responses = { "204": { description: "No body" }, "200": { content: {
    "application/json": { schema: { $ref: "#/components/schemas/Scalar", title: "Count", description: "Documented count" } },
    "text/plain": null
  } } };
  let graph = createOperationGraph(operation, { x: 0, y: 0 }, "variants", document);
  const query = graph.nodes.find(node => node.type === "data" && node.data.label === "Query parameters");
  assert.equal(query.data.fields[0].type, "Integer");
  const response = graph.nodes.find(node => node.type === "data" && node.data.label.includes("application/json"));
  assert.equal(response.data.fields.find(field => field.label === "Response body").type, "Integer");
  assert.equal(response.data.fields.find(field => field.label === "Response body").description, "Documented count");
  assert.ok(graph.nodes.some(node => node.type === "data" && node.data.label === "Response · 204"
    && node.data.fields.some(field => field.label === "Response body" && field.type === "Null")));
  validateWorkflowDocument({ ...plan(), version: 2, ...graph });
  for (const schema of [{ $ref: "#/missing/branch" }, { $ref: "#/components/schemas/Scalar", minimum: 0 },
    { type: ["string", "null"] }, { properties: { named: { type: "string" }, secret: { type: "string", writeOnly: true } } }]) {
    source.responses["200"].content["application/json"].schema = schema;
    graph = createOperationGraph(operation, { x: 0, y: 0 }, "variant", document);
    validateWorkflowDocument({ ...plan(), version: 2, ...graph });
    assert.ok(!graph.nodes.some(node => node.type === "data" && node.data.fields.some(field => field.label === "secret")));
  }
  source.parameters = "not an array";
  source.responses = { "200": { content: null } };
  source.requestBody = { content: { "application/json": null } };
  graph = createOperationGraph(operation, { x: 0, y: 0 }, "unavailable", document);
  validateWorkflowDocument({ ...plan(), version: 2, ...graph });
  operation.fields = [{ location: "query", name: "limit", label: "Limit", type: "integer", required: false, description: "" },
    { location: "body", name: "title", label: "Title", type: "string", required: true, description: "" }];
  graph = createOperationGraph(operation, { x: 0, y: 0 }, "fallback");
  assert.ok(graph.nodes.some(node => node.type === "data" && node.data.fields.some(field => field.label === "Title" && field.required)));
  assert.ok(graph.nodes.some(node => node.type === "data" && node.data.fields.some(field => field.label === "Limit")));
  validateWorkflowDocument({ ...plan(), version: 2, ...graph });
  const hidden = removeGraphSelection({ nodes: [{ id: graph.nodes[1].id }], edges: [] }, graph.nodes, graph.edges);
  assert.deepEqual(removeGraphSelection({ nodes: [], edges: [] }, hidden.nodes, hidden.edges), hidden);
  assert.equal(schemaBranches([], graph.edges).size, 0);
});
Then("oversized field collections and ambiguous structural attachments are rejected", function () {
  const huge = richPlan();
  const template = huge.nodes.find(node => node.type === "data");
  for (let i = 0; i < 26; i++) {
    const id = `extra-${i}`;
    huge.nodes.push({ ...structuredClone(template), id, data: { ...template.data,
      fields: Array.from({ length: 200 }, (_, j) => ({ ...template.data.fields[0], id: `field-${j}` })) } });
    huge.edges.push({ id: `schema:${id}`, kind: "schema", source: id, target: "producer", sourceHandle: "value", targetHandle: `schema:${id}` });
  }
  assert.throws(() => validateWorkflowDocument(huge), /at most 5000 fields/);
  const structural = richPlan();
  structural.edges[0].sourceHandle = "unrecognized";
  assert.throws(() => validateWorkflowDocument(structural), /structural value port/);
  const ambiguous = richPlan();
  const child = panel(ambiguous, "producer", "inputs", "active");
  const attachment = ambiguous.edges.find(edge => edge.id === `schema:${child.id}`);
  ambiguous.nodes.push({ ...structuredClone(child), id: "second-child" });
  ambiguous.edges.push({ ...attachment, id: "schema:second-child", source: "second-child" });
  assert.throws(() => validateWorkflowDocument(ambiguous), /one parent and a unique field handle/);
});

function extendedPlan() {
  const document = { ...richPlan(), version: 3, description: "Route project values locally." };
  const condition = createUtilityNode("switch", { x: 900, y: 100 }, "switch");
  const cast = createUtilityNode("cast", { x: 700, y: 100 }, "cast");
  cast.data.targetType = "Number";
  const comment = createUtilityNode("comment", { x: 600, y: -100 }, "comment");
  comment.data.text = "Review before running.\nNo external service is contacted.";
  document.nodes.push(condition, cast, comment);
  const output = panel(document, "producer", "outputs", "estimate");
  document.edges.push({ id: "to-cast", kind: "mapping", source: output.id, sourceHandle: output.data.fields.find(field => field.label === "estimate").id,
    target: cast.id, targetHandle: "value" }, { id: "to-switch", kind: "mapping", source: cast.id, sourceHandle: "result", target: condition.id, targetHandle: "value" });
  return document;
}
const gate = (operator, value = "", id = "gate") => ({ id, operator, value });
function withGraph(graph, id = "outer") { return { ...plan(), version: 3, id, ...graph }; }
function nestedPlan(snapshot, id = "outer") { return withGraph(createWorkflowGraph(snapshot, { x: 0, y: 0 }, `nested-${id}`), id); }

Given("a workflow containing switches, casts, and comments", function () { this.extended = extendedPlan(); });
When("the extended workflow is exported and imported", function () {
  this.extended.nodes.at(-1).selected = true;
  this.extendedImported = parseWorkflowDocument(JSON.stringify(this.extended));
});
Then("its description, gates, cast settings, comments, and named utility connections survive", function () {
  const expected = extendedPlan();
  assert.deepEqual(this.extendedImported, expected);
  assert.equal(this.extendedImported.version, 3);
  assert.equal(this.extendedImported.description, "Route project values locally.");
});
Then("earlier document versions retain their original supported shape", function () {
  assert.deepEqual(validateWorkflowDocument({ ...plan(), description: "ignored" }), plan());
  assert.deepEqual(validateWorkflowDocument({ ...richPlan(), description: "ignored" }), richPlan());
  assert.throws(() => validateWorkflowDocument({ ...extendedPlan(), version: 2 }), /Unsupported workflow node type/);
});
Then("utility ports accept scalar routes and reject invalid directions, objects, comments, and duplicate operands", function () {
  const p = this.extended;
  p.nodes.find(node => node.id === "cast").data.targetType = "Text";
  const availableEdges = p.edges.filter(edge => edge.kind !== "mapping");
  const input = panel(p, "receiver", "inputs", "name");
  const inputHandle = input.data.fields.find(field => field.label === "name").id;
  const condition = p.nodes.find(node => node.id === "switch");
  const output = panel(p, "producer", "outputs", "id");
  const outputHandle = output.data.fields.find(field => field.label === "id").id;
  const object = panel(p, "producer", "outputs", "project");
  const objectHandle = object.data.fields.find(field => field.label === "project").id;
  const valid = [
    { source: "switch", sourceHandle: "gate-1", target: input.id, targetHandle: inputHandle },
    { source: "switch", sourceHandle: "gate-1", target: "cast", targetHandle: "value" },
    { source: output.id, sourceHandle: outputHandle, target: "switch", targetHandle: "value" },
    { source: output.id, sourceHandle: outputHandle, target: "switch", targetHandle: switchGateInput("gate-1") }
  ];
  for (const candidate of valid) assert.equal(isWorkflowConnection(candidate, p.nodes,
    p.edges.filter(edge => edge.target !== candidate.target || edge.targetHandle !== candidate.targetHandle)), true, JSON.stringify(candidate));
  const invalid = [
    { source: "cast", sourceHandle: "bad", target: "switch", targetHandle: "value" },
    { source: "switch", sourceHandle: "missing", target: "cast", targetHandle: "value" },
    { source: "cast", sourceHandle: "result", target: "comment", targetHandle: "value" },
    { source: "comment", target: "producer" },
    { source: "cast", sourceHandle: "result", target: input.id, targetHandle: "missing" },
    { source: "switch", sourceHandle: "gate-1", target: "cast", targetHandle: "result" },
    { source: output.id, sourceHandle: outputHandle, target: "switch", targetHandle: "missing" },
    { source: object.id, sourceHandle: objectHandle, target: "switch", targetHandle: "value" },
    { source: object.id, sourceHandle: objectHandle, target: "cast", targetHandle: "value" }
  ];
  for (const candidate of invalid) assert.equal(isWorkflowConnection(candidate, p.nodes, availableEdges), false, JSON.stringify(candidate));
  p.edges.push({ ...valid[3], id: "operand", kind: "mapping" });
  assert.equal(isWorkflowConnection({ source: "cast", sourceHandle: "result", target: "switch", targetHandle: switchGateInput("gate-1") }, p.nodes, p.edges), false);
  assert.deepEqual(validateWorkflowDocument(p), p);
  condition.data.gates[0].operator = "is_set";
  assert.throws(() => validateWorkflowDocument(p), /Mappings must connect/);
  assert.equal(isValueConnection({ sourceHandle: "result", targetHandle: "value" }, p.nodes.find(node => node.id === "cast"), p.nodes.find(node => node.id === "cast")), false);
});
Then("deleting a utility removes only its connections and node", function () {
  const result = removeGraphSelection({ nodes: [{ id: "cast" }], edges: [] }, this.extended.nodes, this.extended.edges);
  assert.equal(result.nodes.length, this.extended.nodes.length - 1);
  assert.ok(result.edges.every(edge => edge.source !== "cast" && edge.target !== "cast"));
  assert.equal(result.nodes.filter(node => node.type === "data").length, this.extended.nodes.filter(node => node.type === "data").length);
});
When("switch gates are added, edited, and removed", function () {
  let p = this.extended;
  p = replaceGraph(p, addSwitchGate("switch", "gate-2", p.nodes, p.edges));
  const first = p.nodes.find(node => node.id === "switch").data.gates[0];
  const input = panel(p, "receiver", "inputs", "name");
  p.edges.push({ id: "operand", kind: "mapping", source: "cast", sourceHandle: "result", target: "switch", targetHandle: switchGateInput(first.id) },
    { id: "gate-route", kind: "mapping", source: "switch", sourceHandle: first.id, target: input.id, targetHandle: input.data.fields[0].id });
  p = replaceGraph(p, updateSwitchGate("switch", first.id, { operator: "is_set" }, p.nodes, p.edges));
  this.afterUnary = structuredClone(p);
  this.extended = replaceGraph(p, removeSwitchGate("switch", first.id, p.nodes, p.edges));
});
Then("unary gates lose operand wires and deleted gates lose both kinds of wire", function () {
  assert.ok(!this.afterUnary.edges.some(edge => edge.id === "operand"));
  assert.ok(this.afterUnary.edges.some(edge => edge.id === "gate-route"));
  assert.ok(!this.extended.edges.some(edge => edge.id === "gate-route"));
  assert.deepEqual(this.extended.nodes.find(node => node.id === "switch").data.gates.map(gate => gate.id), ["gate-2"]);
  validateWorkflowDocument(this.extended);
});
Then("switch editing respects gate and value limits", function () {
  let p = this.extended;
  for (const id of ["missing", "comment"]) {
    assert.deepEqual(addSwitchGate(id, "ignored", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
    assert.deepEqual(updateSwitchGate(id, "missing", {}, p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
    assert.deepEqual(removeSwitchGate(id, "missing", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  }
  assert.deepEqual(removeSwitchGate("switch", "gate-2", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  assert.deepEqual(addSwitchGate("switch", "gate-2", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  for (const id of ["", "value", "gate-value:other", "a".repeat(129)]) assert.throws(() => addSwitchGate("switch", id, p.nodes, p.edges), /Invalid switch gate ID/);
  assert.throws(() => updateSwitchGate("switch", "gate-2", { operator: "unsafe" }, p.nodes, p.edges), /Invalid switch gate/);
  assert.throws(() => updateSwitchGate("switch", "gate-2", { value: "x".repeat(4097) }, p.nodes, p.edges), /Invalid switch gate/);
  p = replaceGraph(p, updateSwitchGate("switch", "gate-2", { operator: ">", value: "5" }, p.nodes, p.edges));
  for (let i = 0; i < 31; i++) p = replaceGraph(p, addSwitchGate("switch", `extra-${i}`, p.nodes, p.edges));
  assert.deepEqual(addSwitchGate("switch", "overflow", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  assert.deepEqual(removeSwitchGate("switch", "missing", p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  assert.deepEqual(updateSwitchGate("switch", "missing", { value: "3" }, p.nodes, p.edges), { nodes: p.nodes, edges: p.edges });
  validateWorkflowDocument(p);
});
Then("scalar casts accept documented conversions and reject ambiguous values", function () {
  for (const value of ["1", "  -1.5e+2  ", ".5", "+2."]) assert.equal(numericValue(value), true);
  for (const value of [null, false, "", " ", "Infinity", "1e900", "0x10", "one"]) assert.equal(numericValue(value), false);
  assert.equal(castValue(false, "Text"), "false");
  assert.equal(castValue(0, "Text"), "0");
  for (const [value, expected] of [["2.5", 2.5], [true, 1], [false, 0], [2, 2]]) assert.equal(castValue(value, "Number"), expected);
  for (const value of [true, 1, "true", "1", " TRUE "]) assert.equal(castValue(value, "Boolean"), true);
  for (const value of [false, 0, "false", "0", " FALSE "]) assert.equal(castValue(value, "Boolean"), false);
  for (const value of [[], {}, null, undefined, Infinity, NaN]) assert.throws(() => castValue(value, "Text"), /Only text, finite/);
  for (const value of ["", "words", "Infinity"]) assert.throws(() => castValue(value, "Number"), /valid number/);
  for (const value of [2, "yes", ""]) assert.throws(() => castValue(value, "Boolean"), /only true, false, 1 or 0/);
  assert.throws(() => castValue(1, "Object"), /Unsupported cast/);
});
Then("switch comparisons respect literal types, wired operands, missing values, and gate order", function () {
  for (const [input, operator, value, expected] of [[2, "==", "2", true], [2, "!=", "3", true], [2, ">", "1", true],
    [2, ">=", "2", true], [2, "<", "3", true], [2, "<=", "2", true], [false, "==", "false", true],
    [true, "==", "no", false], [2, "==", "", false], ["a", ">", "b", false], [undefined, "==", "x", false],
    [null, "is_not_set", "", true], [undefined, "is_set", "", false], ["", "is_set", "", true],
    [[], "is_set", "", true], [{}, "is_set", "", true]]) assert.equal(matchesSwitchGate(input, gate(operator, value)), expected);
  assert.equal(matchesSwitchGate("b", gate(">", "a"), "Unknown"), true);
  assert.equal(matchesSwitchGate(false, gate("==", "true"), undefined, new Map([["gate", false]])), true);
  assert.equal(matchesSwitchGate(0, gate("==", "9"), undefined, new Map([["gate", 0]])), true);
  assert.equal(matchesSwitchGate(2, gate("==", "2"), undefined, new Map([["gate", undefined]])), false);
  for (const operand of [[], {}, Infinity]) assert.equal(matchesSwitchGate(2, gate("==", "2"), undefined, new Map([["gate", operand]])), false);
  assert.deepEqual(matchingSwitchGates(2, [gate(">", "1", "first"), gate("==", "2", "second")]), ["first"]);
  assert.deepEqual(matchingSwitchGates(false, [gate("==", "true")]), []);
  assert.deepEqual(operatorsForType("Object").map(operator => operator.value), ["is_set", "is_not_set"]);
});
Then("connected scalar types propagate without recursive traversal", function () {
  let p = this.extended;
  assert.equal(routingInputTypes(p.nodes, p.edges).get("switch"), "Number");
  assert.equal(routingInputTypes(p.nodes, p.edges).get("cast"), "Number");
  const other = createUtilityNode("switch", { x: 0, y: 0 }, "other");
  p.nodes.push(other);
  p.edges.push({ id: "cycle-a", kind: "mapping", source: "switch", sourceHandle: "gate-1", target: "other", targetHandle: "value" },
    { id: "cycle-b", kind: "mapping", source: "other", sourceHandle: "gate-1", target: "switch", targetHandle: "value" });
  assert.equal(routingInputTypes(p.nodes, p.edges).get("other"), "Number");
  const textPanel = panel(p, "producer", "outputs", "title");
  p.edges.push({ id: "mixed", kind: "mapping", source: textPanel.id, sourceHandle: textPanel.data.fields[0].id, target: "other", targetHandle: "value" });
  assert.equal(routingInputTypes(p.nodes, p.edges).get("switch"), "Mixed");
  assert.equal(routingInputTypes([other], []).get("other"), "Unknown");
  assert.equal(routingInputTypes([other, createUtilityNode("switch", { x: 0, y: 0 }, "switch")], p.edges.filter(edge => edge.id.startsWith("cycle"))).get("other"), "Unknown");
  const integerPanel = panel(p, "producer", "inputs", "limit");
  const changed = { ...integerPanel, data: { ...integerPanel.data, direction: "outputs" } };
  assert.equal(routingInputTypes([other, changed], [{ id: "integer", kind: "mapping", source: changed.id, sourceHandle: changed.data.fields[0].id, target: "other", targetHandle: "value" }]).get("other"), "Number");
});
Then("switch literals adapt to inferred types without replacing wired operands", function () {
  assert.deepEqual(gateForType(gate(">", "nonsense"), "Boolean"), gate("==", "true"));
  assert.deepEqual(gateForType(gate("==", "nonsense"), "Number"), gate("==", ""));
  const original = gate("==", "7");
  assert.equal(gateForType(original, "Number"), original);
  const p = this.extended;
  const boolean = createUtilityNode("cast", { x: 0, y: 0 }, "boolean");
  boolean.data.targetType = "Boolean";
  const condition = createUtilityNode("switch", { x: 0, y: 0 }, "boolean-switch");
  condition.data.gates[0].value = "keep wired literal";
  const nodes = [...p.nodes, boolean, condition];
  const edges = [...p.edges, { id: "boolean-input", kind: "mapping", source: "boolean", sourceHandle: "result", target: condition.id, targetHandle: "value" },
    { id: "boolean-operand", kind: "mapping", source: "boolean", sourceHandle: "result", target: condition.id, targetHandle: switchGateInput("gate-1") }];
  assert.equal(adaptRoutingGates(nodes, edges).find(node => node.id === condition.id).data.gates[0].value, "keep wired literal");
  assert.equal(adaptRoutingGates(nodes, edges.slice(0, -1)).find(node => node.id === condition.id).data.gates[0].value, "true");
});

Given("a saved workflow with an internally supplied input", function () {
  this.savedNested = richPlan();
  this.savedNested.edges.push(mapping(this.savedNested));
});
When("that saved workflow is embedded in another workflow", function () {
  this.nested = nestedPlan(this.savedNested);
});
Then("the nested snapshot exposes unsupplied inputs and all visible outputs", function () {
  const excluded = mapping(this.savedNested);
  assert.ok(!this.nested.nodes.some(node => node.type === "data" && node.data.fields.some(field =>
    field.endpoint?.nodeId === excluded.target && field.endpoint.fieldId === excluded.targetHandle)));
  assert.ok(this.nested.nodes.some(node => node.type === "data" && node.data.fields.some(field =>
    field.endpoint?.nodeId === excluded.source && field.endpoint.fieldId === excluded.sourceHandle)));
  assert.ok(this.nested.nodes.filter(node => node.type === "data").every(node => node.data.fields.every(field => field.endpoint)));
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(this.nested)), this.nested);
  const graph = createWorkflowGraph(plan(), { x: 0, y: 0 }, "legacy-owner");
  assert.equal(graph.nodes.length, 3);
  assert.ok(graph.nodes.filter(node => node.type === "data").every(node => node.data.notice));
  validateWorkflowDocument(withGraph(graph));
});
Then("removing the nested owner removes its interface panels", function () {
  const owner = this.nested.nodes.find(node => node.type === "workflow");
  assert.deepEqual(removeGraphSelection({ nodes: [owner], edges: [] }, this.nested.nodes, this.nested.edges), { nodes: [], edges: [] });
});
Then("nested interfaces omit supplied objects, supplied descendants, and hidden branches", function () {
  const p = richPlan();
  const parent = panel(p, "receiver", "inputs", "details");
  const child = panel(p, "receiver", "inputs", "active");
  const output = panel(p, "producer", "outputs", "id");
  const mapping = { id: "partial", kind: "mapping", source: output.id, sourceHandle: output.data.fields[0].id,
    target: child.id, targetHandle: child.data.fields[0].id };
  p.edges.push(mapping);
  let groups = workflowInterface(p);
  assert.ok(!groups.some(group => group.node.id === child.id));
  assert.ok(!groups.find(group => group.node.id === parent.id).fields.some(field => field.label === "details"));
  mapping.target = parent.id;
  mapping.targetHandle = parent.data.fields.find(field => field.label === "details").id;
  groups = workflowInterface(p);
  assert.ok(!groups.some(group => group.node.id === child.id));
  const hidden = removeGraphSelection({ nodes: [{ id: output.id }], edges: [] }, p.nodes, p.edges);
  assert.ok(!workflowInterface({ ...p, ...hidden }).some(group => group.node.id === output.id));
  const empty = createOperationGraph({ id: "unknown", name: "Unknown", description: "", method: "GET", path: "/unknown", fields: [], bodyRequired: false }, { x: 0, y: 0 }, "unknown");
  assert.equal(workflowInterface(withGraph(empty)).length, 2);
});
Then("nested snapshot edits are isolated from the saved source", function () {
  const snapshot = this.nested.nodes.find(node => node.type === "workflow").data.snapshot;
  const previous = this.savedNested.nodes[0].data.name;
  snapshot.nodes[0].data.name = "Changed copy";
  assert.equal(this.savedNested.nodes[0].data.name, previous);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(this.nested)), this.nested);
});
Then("repeated snapshot copies remain valid", function () {
  const first = createWorkflowGraph(this.savedNested, { x: 0, y: 0 }, "first-copy");
  const second = createWorkflowGraph(this.savedNested, { x: 1200, y: 0 }, "second-copy");
  const outer = withGraph({ nodes: [...first.nodes, ...second.nodes], edges: [...first.edges, ...second.edges] });
  assert.deepEqual(validateWorkflowDocument(outer), outer);
  const inner = nestedPlan(this.savedNested, "inner");
  assert.doesNotThrow(() => validateWorkflowDocument(nestedPlan(inner, "outer")));
});
Then("forged nested endpoints and unsupported utility payloads are rejected", function () {
  const nestedMutations = [
    [p => p.nodes[0].data.workflowId = "forged", /must match/],
    [p => p.nodes.find(node => node.type === "data").data.fields[0].endpoint.nodeId = "missing", /Nested interface endpoints/],
    [p => p.nodes.find(node => node.type === "data").data.fields[0].type = "Array", /Nested interface endpoints/],
    [p => p.nodes.find(node => node.type === "data").data.fields[0].endpoint = undefined, /Nested interface endpoints/],
    [p => p.nodes.find(node => node.type === "data").data.fields[0].connectable = false, /Nested interface endpoints/],
    [p => { const data = p.nodes.find(node => node.type === "data").data; data.fields.push({ ...data.fields[0], id: "duplicate-endpoint" }); }, /Nested interface endpoints/]
  ];
  for (const [mutate, reason] of nestedMutations) { const p = structuredClone(this.nested); mutate(p); assert.throws(() => validateWorkflowDocument(p), reason); }
  const mutations = [
    [p => p.nodes.find(node => node.type === "switch").data.gates = [], /between 1 and 32/],
    [p => p.nodes.find(node => node.type === "switch").data.gates = Array(33).fill(gate("==")), /between 1 and 32/],
    [p => p.nodes.find(node => node.type === "switch").data.gates[0].operator = "eval", /supported operator/],
    [p => p.nodes.find(node => node.type === "switch").data.gates[0].id = "value", /distinct output handle/],
    [p => p.nodes.find(node => node.type === "cast").data.targetType = "Object", /cast target/],
    [p => p.nodes.find(node => node.type === "comment").data.text = "x".repeat(16001), /Comment must/],
    [p => p.description = "x".repeat(4001), /Workflow description/],
    [p => p.nodes.find(node => node.type === "data").data.fields[0].endpoint = { nodeId: "x", fieldId: "y" }, /Only nested workflow/],
    [p => p.nodes.find(node => node.type === "data").data.ownerId = "switch", /data owner must refer/]
  ];
  for (const [mutate, reason] of mutations) { const p = extendedPlan(); mutate(p); assert.throws(() => validateWorkflowDocument(p), reason); }
});
Then("cyclic and oversized embedded workflow documents are rejected", function () {
  const cycle = { ...plan(), version: 3, nodes: [], edges: [] };
  cycle.nodes.push({ id: "self", type: "workflow", position: { x: 0, y: 0 }, data: { workflowId: cycle.id, name: "Self", description: "", snapshot: cycle } });
  assert.throws(() => validateWorkflowDocument(cycle), /acyclic snapshots/);
  let deep = { ...plan(), version: 3 };
  for (let index = 0; index < 5; index++) deep = { ...plan(), version: 3, id: `level-${index}`, nodes: [{ id: "nested", type: "workflow", position: { x: 0, y: 0 },
    data: { workflowId: deep.id, name: "Nested", description: "", snapshot: deep } }], edges: [] };
  assert.throws(() => validateWorkflowDocument(deep), /four levels/);
  const manyNodes = { ...plan(), version: 3, nodes: Array.from({ length: 500 }, (_, index) => createUtilityNode("comment", { x: 0, y: 0 }, `note-${index}`)), edges: [] };
  const aggregate = { ...plan(), version: 3, nodes: Array.from({ length: 5 }, (_, index) => ({ id: `nested-${index}`, type: "workflow", position: { x: 0, y: 0 },
    data: { workflowId: manyNodes.id, name: "Large", description: "", snapshot: manyNodes } })), edges: [] };
  assert.throws(() => validateWorkflowDocument(aggregate), /2000 total nodes/);
  for (const node of manyNodes.nodes) node.data.text = "x".repeat(5000);
  assert.throws(() => validateWorkflowDocument(manyNodes), /smaller than 2 MB/);
});
Then("nested schema projection keeps explanatory notices and handles unfinished connections", function () {
  const p = richPlan();
  const target = panel(p, "receiver", "inputs", "active");
  target.data.notice = "Additional fields not expanded";
  const nested = nestedPlan(p);
  const notice = nested.nodes.find(node => node.type === "data" && node.data.notice);
  assert.equal(notice.data.notice, target.data.notice);
  assert.equal(notice.data.fields.length, 1);
  validateWorkflowDocument(nested);
  const condition = createUtilityNode("switch", { x: 0, y: 0 }, "routing");
  const output = panel(p, "producer", "outputs", "title");
  assert.equal(routingInputTypes([condition, output], [{ id: "unfinished", kind: "mapping", source: output.id, sourceHandle: "removed-field", target: condition.id, targetHandle: "value" }]).get(condition.id), "Unknown");
  const { operation, document } = schemaFixture();
  document.paths[operation.path].post.requestBody.content["application/json"].schema.properties.details.properties.active = { type: "object", properties: { nested: { type: "boolean" } } };
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "deep-input", document);
  const deep = withGraph(graph);
  const input = panel(deep, "deep-input", "inputs", "nested");
  const source = panel(deep, "deep-input", "outputs", "id");
  deep.edges.push({ id: "nested-supply", kind: "mapping", source: source.id, sourceHandle: source.data.fields[0].id,
    target: input.id, targetHandle: input.data.fields[0].id });
  assert.ok(!workflowInterface(deep).some(group => group.fields.some(field => field.label === "details" || field.label === "active")));
  const parent = panel(p, "receiver", "inputs", "details");
  target.data.fields.push({ id: "loop", label: "Loop", type: "Object", required: false, description: "", connectable: true });
  const attachment = p.edges.find(edge => edge.id === `schema:${parent.id}`);
  attachment.target = target.id;
  attachment.targetHandle = "loop";
  assert.doesNotThrow(() => workflowInterface(p));
});
Then("aggregate field limits include every repeated snapshot copy", function () {
  const field = { id: "field", label: "Field", type: "Text", required: false, description: "", connectable: true };
  const snapshot = { ...plan(), version: 3, nodes: [plan().nodes[0]], edges: [] };
  for (let index = 0; index < 25; index++) {
    const id = `panel-${index}`;
    snapshot.nodes.push({ id, type: "data", position: { x: 0, y: 0 }, data: { ownerId: "first", direction: "inputs", label: "Inputs",
      fields: Array.from({ length: 200 }, (_, index) => ({ ...field, id: `field-${index}` })) } });
    snapshot.edges.push({ id: `schema:${id}`, kind: "schema", source: id, sourceHandle: "value", target: "first", targetHandle: `schema:${id}` });
  }
  const aggregate = { ...plan(), version: 3, nodes: Array.from({ length: 5 }, (_, index) => ({ id: `nested-${index}`, type: "workflow", position: { x: 0, y: 0 },
    data: { workflowId: snapshot.id, name: "Many fields", description: "", snapshot } })), edges: [] };
  assert.throws(() => validateWorkflowDocument(aggregate), /20000 total fields/);
});

Then("example request graphs include structured forms scalar roots headers and null values", async function () {
  const { operations } = await import("./lib/catalog.ts");
  const { catalogForOperation } = await import("./lib/catalog-registry.ts");
  for (const name of ["mockJsonObject", "mockJsonArray", "mockJsonScalar", "mockPlainText", "mockUrlEncoded", "mockMultipart", "mockParameters"]) {
    const operation = operations.find(operation => operation.id === `demo:${name}`);
    for (const source of [catalogForOperation(operation.id).document, {}]) {
      const graph = createOperationGraph(operation, { x: 0, y: 0 }, name, source);
      const inputs = graph.nodes.filter(node => node.type === "data" && node.data.direction === "inputs");
      assert.ok(inputs.some(node => node.data.fields.length));
      assert.ok(inputs.every(node => node.data.fields.every(field => field.label !== "Response body")));
      if (operation.bodyValue && operation.fields[0].type !== "array")
        assert.ok(inputs.some(node => node.data.fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === "")));
      if (name === "mockJsonObject") assert.ok(inputs.some(node => node.data.fields.some(field => field.type === "Null" && field.connectable)));
      if (name === "mockParameters") assert.ok(inputs.some(node => node.data.label === "Headers"));
      validateWorkflowDocument({ ...plan(), version: 3, nodes: graph.nodes, edges: graph.edges });
    }
  }
  const operation = { id: "sample:text", name: "Text", description: "", method: "POST", path: "/text", fields: [], bodyRequired: false };
  const source = { paths: { "/text": { post: { requestBody: { content: { "text/plain": { schema: { type: "string" } } } } } } } };
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "text", source);
  const field = graph.nodes.find(node => node.type === "data" && node.data.direction === "inputs").data.fields[0];
  assert.equal(field.label, "Request body");
  assert.equal(field.type, "Text");
  assert.equal(JSON.parse(decodeURIComponent(field.id))[1], "");
});

function additionalFixture(schema, direction = "outputs") {
  const { operation, document } = schemaFixture();
  const source = document.paths[operation.path].post;
  if (direction === "inputs") source.requestBody.content["application/json"].schema = schema;
  else source.responses["200"].content["application/json"].schema = schema;
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, "additional", document);
  const node = graph.nodes.find(node => node.type === "data" && (direction === "inputs" ? node.data.label === "Request body"
    : node.id === `additional:${encodeURIComponent(JSON.stringify(["response:200:application/json", "/body"]))}`))
    ?? graph.nodes.find(node => node.type === "data" && node.data.label === "Response · 200");
  return { graph, node, document };
}
const importedGraph = graph => parseWorkflowDocument(JSON.stringify({ ...plan(), version: 3, ...graph }));

Then("open object panels accept typed additional properties with stable escaped handles", function () {
  const types = ["Text", "Integer", "Number", "Boolean", "Object", "Array", "Null"];
  for (const additional of [undefined, true, {}]) {
    const schema = { type: "object", ...(additional === undefined ? {} : { additionalProperties: additional }) };
    const { graph: original, node, document } = additionalFixture(schema);
    let graph = importedGraph(original);
    assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, node.id, document), types);
    for (const type of types) {
      const name = `${type}/~ property`;
      graph = addAdditionalProperty(graph.nodes, graph.edges, node.id, name, type, document);
      const field = graph.nodes.find(item => item.id === node.id).data.fields.at(-1);
      assert.equal(field.type, type);
      assert.equal(field.connectable, true);
      assert.deepEqual(JSON.parse(decodeURIComponent(field.id)), ["response:200:application/json", `/body/${type}~1~0 property`]);
      assert.equal(field.required, false);
      assert.equal(graph.nodes.find(item => item.id === node.id).data.notice, "No named properties documented");
      assert.deepEqual(importedGraph(graph).nodes, graph.nodes);
    }
    assert.equal(original.nodes.find(item => item.id === node.id).data.fields.length, 0);
    const branches = schemaBranches(graph.nodes, graph.edges).get(node.id);
    assert.equal(branches.size, 2);
    const array = graph.nodes.find(item => item.id === [...branches.values()].find(branch => branch.label.startsWith("Array")).childId);
    assert.equal(array.data.fields[0].label, "Items");
    assert.equal(array.data.fields[0].connectable, false);
  }
});
Then("added objects remain extensible after export and import", function () {
  const { graph: original, node, document } = additionalFixture({ type: "object" });
  let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "__proto__", "Object", document);
  graph = importedGraph(graph);
  const childId = [...schemaBranches(graph.nodes, graph.edges).get(node.id).values()][0].childId;
  assert.ok(getAdditionalPropertyTypes(graph.nodes, childId, document).includes("Object"));
  graph = addAdditionalProperty(graph.nodes, graph.edges, childId, "items", "Object", document);
  graph = importedGraph(graph);
  const grandchildId = [...schemaBranches(graph.nodes, graph.edges).get(childId).values()][0].childId;
  graph = addAdditionalProperty(graph.nodes, graph.edges, grandchildId, "a/b~c", "Text", document);
  assert.deepEqual(JSON.parse(decodeURIComponent(graph.nodes.find(item => item.id === grandchildId).data.fields[0].id)),
    ["response:200:application/json", "/body/__proto__/items/a~1b~0c"]);
  importedGraph(graph);
});
Then("typed additional properties create nested object and array branches in both directions", function () {
  for (const direction of ["inputs", "outputs"]) {
    const { graph: original, node, document } = additionalFixture({ type: "object", additionalProperties: { $ref: "#/components/schemas/Extra" } }, direction);
    document.components = { schemas: { Extra: { type: "array", items: { type: "object", additionalProperties: { type: "integer" },
      properties: { fixed: { type: "string" } } } } } };
    assert.deepEqual(getAdditionalPropertyTypes(original.nodes, node.id, document), ["Array"]);
    assert.throws(() => addAdditionalProperty(original.nodes, original.edges, node.id, "wrong", "Text", document), /type is not permitted/);
    let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "values", "Array", document);
    const array = graph.nodes.find(item => item.type === "data" && item.data.label === "values");
    assert.equal(array.data.fields[0].type, "Object");
    const itemsId = [...schemaBranches(graph.nodes, graph.edges).get(array.id).values()][0].childId;
    const items = graph.nodes.find(item => item.id === itemsId);
    assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, items.id, document), ["Integer"]);
    graph = addAdditionalProperty(graph.nodes, graph.edges, items.id, "a/b", "Integer", document);
    const field = graph.nodes.find(item => item.id === items.id).data.fields.at(-1);
    assert.equal(JSON.parse(decodeURIComponent(field.id))[1], `${direction === "outputs" ? "/body" : ""}/values/items/a~1b`);
    const edge = graph.edges.find(edge => edge.id === `schema:${items.id}`);
    assert.equal(direction === "inputs" ? edge.targetHandle : edge.sourceHandle, array.data.fields[0].id);
    assert.deepEqual(importedGraph(graph).nodes, graph.nodes);
  }
  const { graph, node, document } = additionalFixture({ type: "object", required: ["custom"], additionalProperties: { type: "boolean" } });
  const next = addAdditionalProperty(graph.nodes, graph.edges, node.id, "custom", "Boolean", document);
  assert.equal(next.nodes.find(item => item.id === node.id).data.fields[0].required, true);
});
Then("closed synthetic unavailable and constrained panels reject additional properties", function () {
  const schemas = [
    { type: "object", additionalProperties: false }, { type: "object", additionalProperties: "yes" },
    { type: "object", properties: [] }, { type: "object", required: "field" }, { type: "object", maxProperties: -1 },
    { type: "object", minProperties: 3, maxProperties: 2 }, { type: "object", maxProperties: 0 },
    { type: "object", patternProperties: { "^x": { type: "string" } } }, { type: "object", propertyNames: { pattern: "^x" } },
    { type: "object", allOf: [{ additionalProperties: false }] }, { type: ["object", "array"] },
    { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } },
    { type: "object", additionalProperties: { type: "string", not: { type: "string" } } },
    { type: "object", additionalProperties: { $ref: "#/missing" } },
    { type: "object", additionalProperties: { $ref: "#/missing", type: "string" } },
    { type: "object", additionalProperties: { type: "object", additionalProperties: "invalid" } },
    { type: "object", additionalProperties: { type: "array", items: [] } },
    { type: "object", additionalProperties: { type: "string", writeOnly: true } },
    { type: "string" }, { type: "array", items: { type: "string" } }, {}, undefined
  ];
  for (const schema of schemas) {
    const { graph, node, document } = additionalFixture(schema);
    assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, node.id, document), [], JSON.stringify(schema));
    assert.throws(() => addAdditionalProperty(graph.nodes, graph.edges, node.id, "custom", "Text", document), /additional properties|not permitted/);
  }
  const { graph, node, document } = additionalFixture({ type: "object" });
  const parameter = graph.nodes.find(item => item.type === "data" && item.data.label === "Query parameters");
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, parameter.id, document), []);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, node.id, {}), []);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, "missing", document), []);
  const malformed = structuredClone(graph.nodes);
  malformed.find(item => item.id === node.id).id = "additional:%invalid";
  assert.deepEqual(getAdditionalPropertyTypes(malformed, "additional:%invalid", document), []);
  const nested = createWorkflowGraph(importedGraph(graph), { x: 0, y: 0 }, "nested");
  for (const panel of nested.nodes.filter(item => item.type === "data"))
    assert.deepEqual(getAdditionalPropertyTypes(nested.nodes, panel.id, document), []);
  const hidden = removeGraphSelection({ nodes: [{ id: node.id }], edges: [] }, graph.nodes, graph.edges);
  assert.deepEqual(getAdditionalPropertyTypes(hidden.nodes, node.id, document), []);
});
Then("declared hidden fields and repeated names cannot be added again", function () {
  for (const direction of ["inputs", "outputs"]) {
    const { graph, node, document } = additionalFixture({ type: "object", properties: {
      reserved: { type: "string", [direction === "inputs" ? "readOnly" : "writeOnly"]: true },
      key: { type: "string", title: "Renamed label" }
    } }, direction);
    assert.equal(node.data.fields.length, 1);
    for (const name of ["key", "reserved"])
      assert.throws(() => addAdditionalProperty(graph.nodes, graph.edges, node.id, name, "Text", document), /already exists|reserved/);
    const next = addAdditionalProperty(graph.nodes, graph.edges, node.id, "custom", "Text", document);
    assert.throws(() => addAdditionalProperty(next.nodes, next.edges, node.id, "custom", "Text", document), /already exists/);
  }
});
Then("property names fields and nested branches stay within document limits", function () {
  const { graph, node, document } = additionalFixture({ type: "object" });
  for (const name of ["", "  ", "x".repeat(201), "line\nbreak", "\ud800"])
    assert.throws(() => addAdditionalProperty(graph.nodes, graph.edges, node.id, name, "Text", document), /Property names/);
  const wide = additionalFixture({ type: "object", properties: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`field${index}`, { type: "string" }])) });
  assert.deepEqual(getAdditionalPropertyTypes(wide.graph.nodes, wide.node.id, wide.document), []);
  assert.throws(() => addAdditionalProperty(wide.graph.nodes, wide.graph.edges, wide.node.id, "extra", "Text", wide.document), /property limit/);
  let next = graph;
  let id = node.id;
  for (let index = 0; index < 2; index++) {
    next = addAdditionalProperty(next.nodes, next.edges, id, "x".repeat(200), "Object", document);
    id = [...schemaBranches(next.nodes, next.edges).get(id).values()][0].childId;
  }
  assert.throws(() => addAdditionalProperty(next.nodes, next.edges, id, "x".repeat(200), "Text", document), /size or depth limits/);
  const full = structuredClone(graph);
  while (full.nodes.length < 500) full.nodes.push({ id: `comment-${full.nodes.length}`, type: "comment", position: { x: 0, y: 0 }, data: { text: "" } });
  assert.throws(() => addAdditionalProperty(full.nodes, full.edges, node.id, "extra", "Object", document), /at most 500 nodes/);
  assert.equal(full.nodes.length, 500);
});

const addedField = (graph, nodeId, name, document) => getEditableAdditionalProperties(graph.nodes, nodeId, document).find(field => field.name === name).fieldId;
const propertyChild = (graph, nodeId, fieldId) => schemaBranches(graph.nodes, graph.edges).get(nodeId).get(fieldId).childId;

Then("additional property renames preserve escaped handles mappings and hidden descendants", function () {
  for (const direction of ["inputs", "outputs"]) {
    const { graph: original, node, document } = additionalFixture({ type: "object" }, direction);
    let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "a/b", "Object", document);
    graph = addAdditionalProperty(graph.nodes, graph.edges, node.id, "a/b-sibling", "Object", document);
    const fieldId = addedField(graph, node.id, "a/b", document);
    const childId = propertyChild(graph, node.id, fieldId);
    graph = addAdditionalProperty(graph.nodes, graph.edges, childId, "nested~", "Object", document);
    graph = addAdditionalProperty(graph.nodes, graph.edges, childId, "mapped", "Text", document);
    const nestedId = addedField(graph, childId, "nested~", document);
    const nestedChildId = propertyChild(graph, childId, nestedId);
    graph = addAdditionalProperty(graph.nodes, graph.edges, nestedChildId, "leaf", "Text", document);
    const endpoint = direction === "outputs" ? panel(graph, "additional", "inputs", "name") : panel(graph, "additional", "outputs", "error");
    const mappings = [fieldId, addedField(graph, childId, "mapped", document)].map((handle, index) => ({
      id: `preserved-${index}`, kind: "mapping",
      source: direction === "outputs" ? index ? childId : node.id : endpoint.id,
      sourceHandle: direction === "outputs" ? handle : endpoint.data.fields[0].id,
      target: direction === "outputs" ? endpoint.id : index ? childId : node.id,
      targetHandle: direction === "outputs" ? endpoint.data.fields[0].id : handle
    }));
    for (const edge of mappings) edge.manualRoute = manualRoute();
    graph.edges.push(...mappings);
    graph.edges.find(edge => edge.id === `schema:${nestedChildId}`).manualRoute = manualRoute();
    graph = removeGraphSelection({ nodes: [{ id: nestedChildId }], edges: [] }, graph.nodes, graph.edges);
    graph = importedGraph(graph);
    const before = structuredClone(graph);
    const siblingId = propertyChild(graph, node.id, addedField(graph, node.id, "a/b-sibling", document));
    graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "renamed/~", "Object", document);
    const nextFieldId = addedField(graph, node.id, "renamed/~", document);
    const nextChildId = propertyChild(graph, node.id, nextFieldId);
    const nextNestedId = addedField(graph, nextChildId, "nested~", document);
    const nextNestedChildId = propertyChild(graph, nextChildId, nextNestedId);
    assert.deepEqual(graph.nodes.find(item => item.id === siblingId), before.nodes.find(item => item.id === siblingId));
    assert.deepEqual(graph.nodes.find(item => item.id === nextChildId).position, before.nodes.find(item => item.id === childId).position);
    assert.equal(graph.nodes.find(item => item.id === nextChildId).data.label, "renamed/~");
    assert.equal(graph.nodes.find(item => item.id === nextNestedChildId).hidden, true);
    assert.equal(graph.edges.find(edge => edge.id === `schema:${nextNestedChildId}`).detached, true);
    assert.equal(graph.edges.find(edge => edge.id === `schema:${nextNestedChildId}`).hidden, true);
    assert.deepEqual(graph.edges.find(edge => edge.id === `schema:${nextNestedChildId}`).manualRoute, manualRoute());
    const renamedMappings = graph.edges.filter(edge => edge.kind === "mapping");
    assert.deepEqual(renamedMappings.map(edge => edge.id), mappings.map(edge => edge.id));
    assert.ok(renamedMappings.every(edge => JSON.stringify(edge.manualRoute) === JSON.stringify(manualRoute())));
    assert.equal(direction === "outputs" ? renamedMappings[0].sourceHandle : renamedMappings[0].targetHandle, nextFieldId);
    assert.equal(direction === "outputs" ? renamedMappings[1].source : renamedMappings[1].target, nextChildId);
    const descendantHandle = direction === "outputs" ? renamedMappings[1].sourceHandle : renamedMappings[1].targetHandle;
    assert.equal(JSON.parse(decodeURIComponent(descendantHandle))[1], `${direction === "outputs" ? "/body" : ""}/renamed~1~0/mapped`);
    assert.deepEqual(importedGraph(graph).nodes, graph.nodes);
    assert.deepEqual(graph.nodes.find(item => item.id === node.id).data.fields.map(field => field.label), ["renamed/~", "a/b-sibling"]);
  }
});

Then("property type changes retain compatible mappings and replace obsolete descendants", function () {
  const { graph: original, node, document } = additionalFixture({ type: "object" });
  let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "change", "Number", document);
  graph = addAdditionalProperty(graph.nodes, graph.edges, node.id, "last", "Text", document);
  const fieldId = addedField(graph, node.id, "change", document);
  const endpoint = panel(graph, "additional", "inputs", "name");
  graph.nodes.push(createUtilityNode("cast", { x: 800, y: 0 }, "cast"), createUtilityNode("switch", { x: 900, y: 0 }, "switch"));
  graph.nodes.find(item => item.id === "switch").data.gates[0] = { id: "gate-1", operator: ">", value: "20" };
  graph.edges.push(...["cast", "switch", endpoint.id].map(target => ({ id: `mapped-${target}`, kind: "mapping", source: node.id,
    sourceHandle: fieldId, target, targetHandle: target === endpoint.id ? endpoint.data.fields[0].id : "value" })));
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "change", "Boolean", document);
  assert.equal(graph.edges.filter(edge => edge.kind === "mapping").length, 3);
  assert.deepEqual(graph.nodes.find(item => item.id === "switch").data.gates[0], { id: "gate-1", operator: "==", value: "true" });
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "change", "Object", document);
  assert.deepEqual(graph.edges.filter(edge => edge.kind === "mapping").map(edge => edge.target), [endpoint.id]);
  const childId = propertyChild(graph, node.id, fieldId);
  graph = addAdditionalProperty(graph.nodes, graph.edges, childId, "nested", "Text", document);
  const nestedField = addedField(graph, childId, "nested", document);
  graph.edges.push({ id: "obsolete-child-mapping", kind: "mapping", source: childId, sourceHandle: nestedField,
    target: endpoint.id, targetHandle: endpoint.data.fields[0].id });
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "changed-name", "Array", document);
  const nextFieldId = addedField(graph, node.id, "changed-name", document);
  const arrayId = propertyChild(graph, node.id, nextFieldId);
  assert.equal(graph.nodes.some(item => item.id === childId), false);
  assert.equal(graph.edges.some(edge => edge.id === "obsolete-child-mapping"), false);
  assert.equal(graph.nodes.find(item => item.id === arrayId).data.fields[0].label, "Items");
  assert.equal(graph.edges.find(edge => edge.kind === "mapping").sourceHandle, nextFieldId);
  assert.deepEqual(graph.nodes.find(item => item.id === node.id).data.fields.map(field => field.label), ["changed-name", "last"]);
  const position = graph.nodes.find(item => item.id === arrayId).position;
  graph = removeGraphSelection({ nodes: [{ id: arrayId }], edges: [] }, graph.nodes, graph.edges);
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, nextFieldId, "changed-name", "Object", document);
  assert.deepEqual(graph.nodes.find(item => item.id === arrayId).position, position);
  assert.equal(graph.nodes.find(item => item.id === arrayId).hidden, true);
  assert.equal(graph.edges.find(edge => edge.id === `schema:${arrayId}`).detached, true);
  assert.equal(graph.edges.find(edge => edge.id === `schema:${arrayId}`).hidden, true);
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, nextFieldId, "changed-name", "Text", document);
  assert.equal(graph.nodes.some(item => item.id === arrayId), false);
  assert.equal(schemaBranches(graph.nodes, graph.edges).get(node.id), undefined);
  importedGraph(graph);
});

Then("removing added properties retains unrelated graph state and documented fields", function () {
  const { graph: original, node, document } = additionalFixture({ type: "object", properties: { fixed: { type: "string" } } });
  let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "remove", "Object", document);
  graph = addAdditionalProperty(graph.nodes, graph.edges, node.id, "remove-sibling", "Text", document);
  const fieldId = addedField(graph, node.id, "remove", document);
  const childId = propertyChild(graph, node.id, fieldId);
  graph = addAdditionalProperty(graph.nodes, graph.edges, childId, "child", "Text", document);
  const target = panel(graph, "additional", "inputs", "name");
  graph.edges.push({ id: "child-mapping", kind: "mapping", source: childId, sourceHandle: addedField(graph, childId, "child", document),
    target: target.id, targetHandle: target.data.fields[0].id });
  graph.edges.push({ id: "sibling-mapping", kind: "mapping", source: node.id, sourceHandle: addedField(graph, node.id, "remove-sibling", document),
    target: target.id, targetHandle: target.data.fields[0].id });
  const before = structuredClone(graph);
  graph = removeAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, document);
  assert.equal(graph.nodes.some(item => item.id === childId), false);
  assert.equal(graph.edges.some(edge => edge.id === "child-mapping" || edge.id === `schema:${childId}`), false);
  assert.deepEqual(graph.edges.find(edge => edge.id === "sibling-mapping"), before.edges.find(edge => edge.id === "sibling-mapping"));
  assert.deepEqual(graph.nodes.filter(item => item.id !== node.id), before.nodes.filter(item => ![node.id, childId].includes(item.id)));
  assert.deepEqual(graph.nodes.find(item => item.id === node.id).data.fields.map(field => field.label), ["fixed", "remove-sibling"]);
  const fixed = node.data.fields[0].id;
  assert.throws(() => removeAdditionalProperty(graph.nodes, graph.edges, node.id, fixed, document), /Only user-added properties/);
  assert.throws(() => updateAdditionalProperty(graph.nodes, graph.edges, node.id, fixed, "editable", "Text", document), /Only user-added properties/);
  importedGraph(graph);
});

Then("property edits use canonical names and enforce schema policy without addition limits", function () {
  const { graph: original, node, document } = additionalFixture({ type: "object", maxProperties: 2,
    properties: { fixed: { type: "string" } }, additionalProperties: { type: "string", title: "Schema title" } });
  let graph = addAdditionalProperty(original.nodes, original.edges, node.id, "actual/name", "Text", document);
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, node.id, document), []);
  const fieldId = addedField(graph, node.id, "actual/name", document);
  assert.deepEqual(getEditableAdditionalProperties(graph.nodes, node.id, document), [{ fieldId, name: "actual/name", types: ["Text"] }]);
  const noOp = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "actual/name", "Text", document);
  assert.equal(noOp.nodes, graph.nodes);
  assert.equal(noOp.edges, graph.edges);
  for (const [name, type, reason] of [["fixed", "Text", /reserved/], ["new", "Object", /not permitted/], ["", "Text", /Property names/]])
    assert.throws(() => updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, name, type, document), reason);
  graph = updateAdditionalProperty(graph.nodes, graph.edges, node.id, fieldId, "renamed~", "Text", document);
  assert.equal(graph.nodes.find(item => item.id === node.id).data.fields[1].label, "Schema title");
  assert.equal(getEditableAdditionalProperties(graph.nodes, node.id, document)[0].name, "renamed~");
  const wide = additionalFixture({ type: "object" });
  const fields = Array.from({ length: 200 }, (_, index) => ({ id: encodeURIComponent(JSON.stringify(["response:200:application/json", `/body/custom${index}`])),
    label: `custom${index}`, type: "Text", required: false, description: "", connectable: true }));
  wide.graph.nodes.find(item => item.id === wide.node.id).data.fields = fields;
  assert.equal(getEditableAdditionalProperties(wide.graph.nodes, wide.node.id, wide.document).length, 200);
  const updated = updateAdditionalProperty(wide.graph.nodes, wide.graph.edges, wide.node.id, fields[0].id, "updated", "Object", wide.document);
  assert.equal(updated.nodes.find(item => item.id === wide.node.id).data.fields.length, 200);
  assert.equal(updated.nodes.find(item => item.id === wide.node.id).data.fields[0].type, "Object");
  importedGraph(updated);
});

Then('named connection styles survive export while legacy flags retain their appearance', async () => {
  const { workflowLineStyle } = await import('./lib/workflow-line-style.ts');
  assert.equal(workflowLineStyle(plan()), 'orthogonal');
  assert.equal(workflowLineStyle({ curved: true }), 'filleted');
  assert.equal(workflowLineStyle({ curved: true, lineStyle: 'invalid' }), 'filleted');
  assert.equal(workflowLineStyle({ curved: false, lineStyle: null }), 'orthogonal');
  for (const lineStyle of ['orthogonal', 'filleted', 'bezier', 'clutter', 'flowing']) {
    const document = parseWorkflowDocument(JSON.stringify({ ...plan(), lineStyle }));
    assert.equal(document.lineStyle, lineStyle);
    assert.equal(document.curved, lineStyle !== 'orthogonal');
    assert.equal(workflowLineStyle(document), lineStyle);
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(document)), document);
  }
  for (const lineStyle of ['', 'invalid', 1, null])
    assert.throws(() => validateWorkflowDocument({ ...plan(), lineStyle }), /Unsupported connection line style/);
});
