// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { workflowStorageKey, maxWorkflowFileSize, validateWorkflowDocument, parseWorkflowDocument, loadWorkflowDocuments, saveWorkflowDocument, removeWorkflowDocument, removeWorkflowDocuments } from "./lib/workflow-document.ts";
import { createOperationGraph, schemaBranches, isWorkflowConnection, removeGraphSelection, restoreDataBranch, createUtilityNode, createWorkflowGraph, addSwitchGate, updateSwitchGate, removeSwitchGate } from "./lib/workflow-graph.ts";
import { numericValue, castValue, matchesSwitchGate, matchingSwitchGates, routingInputTypes, operatorsForType, gateForType,
  adaptRoutingGates, switchGateInput, workflowInterface, isValueConnection } from "./lib/workflow-utilities.ts";

function plan() {
  const data = { operationId: "demo:listProjects", name: "List projects", description: "", method: "GET", path: "/projects" };
  return { version: 1, id: "plan-1", name: "Project review", nodes: [
    { id: "first", position: { x: 10, y: 20 }, data: { ...data } },
    { id: "second", position: { x: 200, y: 100 }, data: { ...data } }
  ], edges: [{ id: "connection", source: "first", target: "second" }],
  viewport: { x: -80, y: 12, zoom: 0.75 }, snap: true, curved: false, dashed: true };
}

function memory(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, workflowStorageKey); return value; },
    setItem(key, next) { assert.equal(key, workflowStorageKey); value = next; }
  };
}

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
Given("an empty local workflow collection", function () { this.storage = memory(); assert.deepEqual(loadWorkflowDocuments(this.storage), []); });
When("a workflow is saved, renamed, and saved again", function () {
  saveWorkflowDocument(this.storage, plan());
  saveWorkflowDocument(this.storage, { ...plan(), name: "Updated review" });
});
Then("there is one saved workflow with the new name", function () {
  const saved = loadWorkflowDocuments(this.storage);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "Updated review");
});
When("that workflow is removed", function () {
  removeWorkflowDocument(this.storage, "not-the-document");
  assert.equal(loadWorkflowDocuments(this.storage).length, 1);
  removeWorkflowDocument(this.storage, "plan-1");
});
Then("the local workflow collection is empty", function () { assert.deepEqual(loadWorkflowDocuments(this.storage), []); });

Given("a version 1 document saved under the original storage key", function () {
  // A pre-rename payload and key are deliberately independent of the new helpers.
  this.originalStorageKey = "operations-flow-documents-v1";
  this.originalDocuments = JSON.parse(`[{"version":1,"id":"existing-1","name":"Untitled flowchart","nodes":[{"id":"operation-1","position":{"x":10,"y":20},"data":{"operationId":"demo:listProjects","name":"List projects","description":"","method":"GET","path":"/projects"}}],"edges":[],"viewport":{"x":-80,"y":12,"zoom":0.75},"snap":true,"curved":false,"dashed":true}]`);
  this.storedValues = new Map([[this.originalStorageKey, JSON.stringify(this.originalDocuments)]]);
  this.storage = {
    getItem: key => this.storedValues.get(key) ?? null,
    setItem: (key, value) => this.storedValues.set(key, value)
  };
});
When("that saved document is loaded and saved as a workflow", function () {
  this.loadedDocuments = loadWorkflowDocuments(this.storage);
  assert.deepEqual(this.loadedDocuments, this.originalDocuments);
  saveWorkflowDocument(this.storage, this.loadedDocuments[0]);
});
Then("its storage key, document name, and version 1 data remain unchanged", function () {
  assert.equal(workflowStorageKey, this.originalStorageKey);
  assert.deepEqual([...this.storedValues.keys()], [this.originalStorageKey]);
  assert.deepEqual(JSON.parse(this.storedValues.get(this.originalStorageKey)), this.originalDocuments);
});

Then("invalid and duplicate stored collections are rejected", function () {
  for (const value of [{}, Array(51).fill(plan())]) {
    assert.throws(() => loadWorkflowDocuments(memory(JSON.stringify(value))), /at most 50 documents/);
  }
  assert.throws(() => loadWorkflowDocuments(memory(JSON.stringify([plan(), plan()]))), /IDs must be unique/);
  assert.throws(() => loadWorkflowDocuments(memory("broken")), SyntaxError);
});
Then("a full collection rejects a new plan but permits updating an existing plan", function () {
  const documents = Array.from({ length: 50 }, (_, index) => ({ ...plan(), id: String(index) }));
  const storage = memory(JSON.stringify(documents));
  assert.throws(() => saveWorkflowDocument(storage, plan()), /collection is full/);
  saveWorkflowDocument(storage, { ...plan(), id: "0", name: "Updated" });
  assert.equal(loadWorkflowDocuments(storage).length, 50);
  assert.equal(loadWorkflowDocuments(storage).at(-1).name, "Updated");
});
Then("storage access and quota failures are reported to the caller", function () {
  const blocked = { getItem() { throw new Error("Storage is blocked"); } };
  assert.throws(() => loadWorkflowDocuments(blocked), /Storage is blocked/);
  const quota = { ...memory(), setItem() { throw new Error("Quota exceeded"); } };
  assert.throws(() => saveWorkflowDocument(quota, plan()), /Quota exceeded/);
  assert.throws(() => removeWorkflowDocument(quota, "plan-1"), /Quota exceeded/);
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
Then("location panels and successful response panels have stable named field handles", function () {
  const nodes = this.rich.nodes.filter(node => node.type === "data" && node.data.ownerId === "producer");
  assert.deepEqual(nodes.slice(0, 3).map(node => node.data.label), ["Path parameters", "Query parameters", "Request body"]);
  assert.ok(nodes.some(node => node.data.label === "Response · 200"));
  assert.ok(!nodes.some(node => node.data.label.includes("400")));
  const escaped = panel(this.rich, "producer", "outputs", "a/b~c").data.fields.find(field => field.label === "a/b~c");
  assert.deepEqual(JSON.parse(decodeURIComponent(escaped.id)), ["output:200:application/json", "/a~1b~0c"]);
  assert.ok(nodes.every(node => node.data.fields.every(field => field.id !== "value")));
  assert.equal(panel(this.rich, "producer", "inputs", "name").data.fields.find(field => field.label === "name").required, true);
  assert.equal(panel(this.rich, "producer", "inputs", "projectId").data.fields[0].description, "Project identity");
  assert.deepEqual(validateWorkflowDocument(this.rich), this.rich);
  const { operation, document } = schemaFixture();
  const relocated = createOperationGraph(operation, { x: 20, y: 60 }, "producer", document);
  assert.deepEqual(relocated.nodes.map(node => node.id), this.rich.nodes.filter(node => node.id === "producer" || node.data.ownerId === "producer").map(node => node.id));
  const branch = schemaBranches(this.rich.nodes, this.rich.edges).get("producer");
  assert.equal([...branch.values()].filter(value => value.direction === "inputs").length, 3);
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
  const output = exampleOnly.nodes.find(node => node.type === "data" && node.data.direction === "outputs");
  assert.deepEqual(output.data.fields, []);
  assert.match(output.data.notice, /No named properties/);
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
Then("the version 2 workflow survives a save and import with its handles and branch state", function () {
  this.rich.nodes[0].selected = true;
  this.rich.nodes[0].width = 160;
  this.rich.nodes[0].measured = { width: 160, height: 100 };
  this.rich.edges[0].selected = true;
  const storage = memory();
  saveWorkflowDocument(storage, this.rich);
  this.richImported = parseWorkflowDocument(JSON.stringify(loadWorkflowDocuments(storage)[0]));
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
    targetHandle: target.data.fields.find(field => field.label === "enabled").id }, this.rich.nodes, this.rich.edges), true);
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
  this.beforeRemoval = structuredClone(this.rich);
  this.rich = replaceGraph(this.rich, removeGraphSelection({ nodes: [], edges: [{ id: `schema:${this.branch.childId}` }] }, this.rich.nodes, this.rich.edges));
});
Then("that branch and its descendants are hidden while their topology is retained", function () {
  assert.equal(this.rich.nodes.length, this.beforeRemoval.nodes.length);
  assert.equal(this.rich.edges.length, this.beforeRemoval.edges.length);
  assert.equal(this.rich.nodes.find(node => node.id === this.branch.childId).hidden, true);
  assert.equal(panel(this.rich, "producer", "outputs", "title").hidden, true);
  assert.equal(this.rich.edges.find(edge => edge.id === `schema:${this.branch.childId}`).detached, true);
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
    const outputs = graph.nodes.filter(node => node.type === "data" && node.data.direction === "outputs");
    assert.ok(outputs.some(node => node.data.notice));
    assert.ok(outputs.every(node => node.data.fields.every(field => !field.connectable)));
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
  assert.equal(response.data.fields[0].type, "Integer");
  assert.equal(response.data.fields[0].description, "Documented count");
  assert.ok(graph.nodes.some(node => node.type === "data" && node.data.label === "Response · 204" && node.data.notice));
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
When("the extended workflow is saved and imported", function () {
  const storage = memory();
  this.extended.nodes.at(-1).selected = true;
  saveWorkflowDocument(storage, this.extended);
  this.extendedImported = parseWorkflowDocument(JSON.stringify(loadWorkflowDocuments(storage)[0]));
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
  for (const candidate of valid) assert.equal(isWorkflowConnection(candidate, p.nodes, p.edges), true, JSON.stringify(candidate));
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
  for (const candidate of invalid) assert.equal(isWorkflowConnection(candidate, p.nodes, p.edges), false, JSON.stringify(candidate));
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
  const storage = memory();
  saveWorkflowDocument(storage, this.nested);
  assert.deepEqual(loadWorkflowDocuments(storage)[0], this.nested);
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
Then("selected saved workflows are removed together and failed storage leaves the collection intact", function () {
  const initial = [plan(), { ...plan(), id: "keep" }, { ...plan(), id: "remove" }];
  let stored = JSON.stringify(initial);
  let writes = 0;
  const storage = { getItem: () => stored, setItem: (_key, value) => { writes++; stored = value; } };
  removeWorkflowDocuments(storage, ["plan-1", "remove"]);
  assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(stored).map(document => document.id), ["keep"]);
  assert.throws(() => removeWorkflowDocuments({ ...storage, setItem: () => { throw new Error("blocked"); } }, ["keep"]), /blocked/);
  assert.deepEqual(JSON.parse(stored).map(document => document.id), ["keep"]);
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
