// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { parseWorkflowDocument } from "./lib/workflow-document.ts";
import { isWorkflowConnection } from "./lib/workflow-graph.ts";
import { switchGateInput, workflowInputConnected } from "./lib/workflow-utilities.ts";

function operation(id) {
  return { id, position: { x: 0, y: 0 }, data: {
    operationId: "demo:listProjects", name: "List projects", description: "", method: "GET", path: "/projects"
  } };
}

function field(id) {
  return { id, label: id, type: "Text", required: false, description: "", connectable: true };
}

function fixture() {
  const nodes = [operation("producer"), operation("receiver"), operation("legacy-a"), operation("legacy-b"), operation("legacy-target"),
    { id: "output", type: "data", position: { x: 0, y: 0 },
      data: { ownerId: "producer", direction: "outputs", label: "Response", fields: [field("first"), field("second"), { ...field("object"), type: "Object" }] } },
    { id: "input", type: "data", position: { x: 0, y: 0 },
      data: { ownerId: "receiver", direction: "inputs", label: "Input", fields: [field("first"), field("second"), { ...field("object"), type: "Object" }] } },
    { id: "nested-input", type: "data", position: { x: 0, y: 0 },
      data: { ownerId: "receiver", direction: "inputs", label: "Object", fields: [field("nested")] } },
    { id: "cast", type: "cast", position: { x: 0, y: 0 }, data: { targetType: "Text" } },
    { id: "switch", type: "switch", position: { x: 0, y: 0 },
      data: { gates: [{ id: "gate-1", operator: "==", value: "" }, { id: "gate-2", operator: "==", value: "" }] } }
  ];
  const edges = [
    { id: "schema:output", kind: "schema", source: "producer", sourceHandle: "schema:output", target: "output", targetHandle: "value" },
    { id: "schema:input", kind: "schema", source: "input", sourceHandle: "value", target: "receiver", targetHandle: "schema:input" },
    { id: "schema:nested-input", kind: "schema", source: "nested-input", sourceHandle: "value", target: "input", targetHandle: "object" }
  ];
  return { version: 3, id: "input-occupancy", name: "Connected inputs", nodes, edges,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
}

const targets = {
  field: { target: "input", targetHandle: "first" },
  cast: { target: "cast", targetHandle: "value" },
  "switch value": { target: "switch", targetHandle: "value" },
  "switch operand": { target: "switch", targetHandle: switchGateInput("gate-1") }
};

function candidate(input, source = "first") {
  return input === "legacy" ? { source: source === "first" ? "legacy-a" : "legacy-b", target: "legacy-target" }
    : { source: "output", sourceHandle: source, ...targets[input] };
}

function edge(connection, id = "connected") {
  return { id, ...connection, ...(connection.sourceHandle ? { kind: "mapping" } : {}) };
}

Then(/^the (field|cast|switch value|switch operand|legacy) input rejects another connection and unlocks after removal$/, function (input) {
  const doc = fixture();
  const first = candidate(input);
  const next = candidate(input, "second");
  assert.equal(isWorkflowConnection(first, doc.nodes, doc.edges), true);
  doc.edges.push(edge(first));
  assert.equal(workflowInputConnected(first.target, first.targetHandle, doc.edges), true);
  assert.equal(isWorkflowConnection(first, doc.nodes, doc.edges), false, "the existing connection cannot be duplicated");
  assert.equal(isWorkflowConnection(next, doc.nodes, doc.edges), false, "a different source cannot occupy the same input");
  doc.edges = doc.edges.filter(item => item.id !== "connected");
  assert.equal(workflowInputConnected(first.target, first.targetHandle, doc.edges), false);
  assert.equal(isWorkflowConnection(next, doc.nodes, doc.edges), true);
});

Then("a connected output can supply other input fields and nodes", function () {
  const doc = fixture();
  const first = candidate("field");
  doc.edges.push(edge(first));
  for (const connection of [{ ...first, targetHandle: "second" }, candidate("cast"), candidate("switch value"), candidate("switch operand")]) {
    assert.equal(isWorkflowConnection(connection, doc.nodes, doc.edges), true);
    doc.edges.push(edge(connection, `fanout-${doc.edges.length}`));
  }
  assert.equal(isWorkflowConnection({ ...candidate("switch operand"), targetHandle: switchGateInput("gate-2") }, doc.nodes, doc.edges), true);
  doc.nodes.push({ ...doc.nodes.find(node => node.id === "input"), id: "other-input" });
  assert.equal(isWorkflowConnection({ ...first, target: "other-input" }, doc.nodes, doc.edges), true);
});

Then("schema, hidden, and detached edges leave value inputs available", function () {
  const doc = fixture();
  const connection = candidate("field");
  const object = { ...connection, sourceHandle: "object", targetHandle: "object" };
  assert.equal(workflowInputConnected(object.target, object.targetHandle, doc.edges), false);
  assert.equal(isWorkflowConnection(object, doc.nodes, doc.edges), true);
  doc.edges.push(edge(object, "whole-object"));
  assert.equal(isWorkflowConnection({ ...object, sourceHandle: "second" }, doc.nodes, doc.edges), false);
  for (const flags of [{ hidden: true }, { detached: true }]) {
    const edges = [...doc.edges, { ...edge(connection), ...flags }];
    assert.equal(workflowInputConnected(connection.target, connection.targetHandle, edges), false, JSON.stringify(flags));
    assert.equal(isWorkflowConnection(connection, doc.nodes, edges), true, JSON.stringify(flags));
  }
});

Then("null and omitted input handles share the same occupancy", function () {
  const doc = fixture();
  for (const storedHandle of [undefined, null]) for (const targetHandle of [undefined, null]) {
    const edges = [edge({ ...candidate("legacy"), targetHandle: storedHandle })];
    assert.equal(workflowInputConnected("legacy-target", targetHandle, edges), true);
    assert.equal(isWorkflowConnection({ ...candidate("legacy", "second"), targetHandle }, doc.nodes, edges), false);
    assert.equal(workflowInputConnected("legacy-target", "named", edges), false);
  }
});

Then("saved workflows with multiple sources for an input still import without losing edges", function () {
  for (const input of ["field", "cast", "switch value", "legacy"]) {
    const doc = fixture();
    doc.edges.push(edge(candidate(input), "first-source"), edge(candidate(input, "second"), "second-source"));
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(doc)), doc, input);
  }
  for (const version of [1, 2]) {
    const doc = fixture();
    doc.version = version;
    doc.nodes = doc.nodes.filter(node => node.id.startsWith("legacy-"));
    doc.edges = [edge(candidate("legacy"), "first-source"), edge(candidate("legacy", "second"), "second-source")];
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(doc)), doc, `version ${version}`);
  }
});
