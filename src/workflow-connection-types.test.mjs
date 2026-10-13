// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { parseWorkflowDocument } from "./lib/workflow-document.ts";
import { isWorkflowConnection } from "./lib/workflow-graph.ts";
import { isWorkflowConnectionTypeCompatible, switchGateInput } from "./lib/workflow-utilities.ts";

const known = ["Text", "Integer", "Number", "Boolean", "Object", "Array", "Null"];
const scalars = ["Text", "Integer", "Number", "Boolean"];
const types = [...known, "Unknown"];
const compatible = (source, target) => source === target || source === "Integer" && target === "Number";
const comparable = (source, target) => source === target || [source, target].every(type => ["Integer", "Number"].includes(type));
const position = { x: 0, y: 0 };

function fixture() {
  const operation = id => ({ id, position, data: {
    operationId: "demo:listProjects", name: "List projects", description: "", method: "GET", path: "/projects"
  } });
  const panel = (id, ownerId, direction) => ({ id, type: "data", position, data: {
    ownerId, direction, label: id, fields: types.map(type => ({
      id: type, label: type, type, required: false, description: "", connectable: type !== "Unknown"
    }))
  } });
  return {
    version: 3, id: "connection-types", name: "Typed connections",
    nodes: [operation("producer"), operation("receiver"), panel("output", "producer", "outputs"),
      panel("input", "receiver", "inputs"),
      { id: "cast", type: "cast", position, data: { targetType: "Text" } },
      ...["first", "second", "third"].map(id => ({ id, type: "switch", position,
        data: { gates: [{ id: "gate", operator: "==", value: "" }] } }))],
    edges: [
      { id: "schema:output", kind: "schema", source: "producer", sourceHandle: "schema:output", target: "output", targetHandle: "value" },
      { id: "schema:input", kind: "schema", source: "input", sourceHandle: "value", target: "receiver", targetHandle: "schema:input" }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false
  };
}

const fieldConnection = (source, target) => ({ source: "output", sourceHandle: source, target: "input", targetHandle: target });
const into = (type, target, targetHandle = "value") => ({ source: "output", sourceHandle: type, target, targetHandle });
const from = (source, target, targetHandle) => ({ source, sourceHandle: source === "cast" ? "result" : "gate", target, targetHandle });
const wire = (doc, connection, flags = {}) => doc.edges.push({ id: `mapping-${doc.edges.length}`, kind: "mapping", ...connection, ...flags });
const accepts = (doc, connection) => isWorkflowConnection(connection, doc.nodes, doc.edges);

Then("workflow fields allow exact types and Integer to Number only", function () {
  const doc = fixture();
  for (const source of types) for (const target of types) {
    assert.equal(accepts(doc, fieldConnection(source, target)),
      source !== "Unknown" && target !== "Unknown" && compatible(source, target), `${source} to ${target}`);
  }
});

Then("Cast connections accept known scalars and use the selected output type", function () {
  const doc = fixture();
  for (const source of types) {
    assert.equal(accepts(doc, into(source, "cast")), scalars.includes(source), source);
    assert.equal(isWorkflowConnectionTypeCompatible(into(source, "cast"), doc.nodes, doc.edges), scalars.includes(source), source);
  }
  for (const targetType of ["Text", "Number", "Boolean"]) {
    doc.nodes.find(node => node.id === "cast").data.targetType = targetType;
    for (const target of types) assert.equal(accepts(doc, from("cast", "input", target)),
      compatible(targetType, target), `${targetType} Cast to ${target}`);
    assert.equal(accepts(doc, from("cast", "first", "value")), true);
  }
});

Then("Switch chains preserve Integer and the other scalar types", function () {
  for (const source of scalars) {
    const doc = fixture();
    assert.equal(accepts(doc, into(source, "first")), true);
    wire(doc, into(source, "first"));
    for (const [upstream, downstream] of [["first", "second"], ["second", "third"]]) {
      const connection = from(upstream, downstream, "value");
      assert.equal(accepts(doc, connection), true);
      wire(doc, connection);
    }
    for (const node of ["first", "second", "third"]) {
      for (const target of types) assert.equal(accepts(doc, from(node, "input", target)),
        compatible(source, target), `${source} through ${node} to ${target}`);
      assert.equal(accepts(doc, from(node, "cast", "value")), true);
    }
  }
});

Then("unresolved Switch outputs cannot supply new connections", function () {
  const unwired = fixture();
  const mixed = fixture();
  wire(mixed, into("Integer", "first"));
  wire(mixed, into("Text", "first"));
  const cyclic = fixture();
  wire(cyclic, from("first", "second", "value"));
  wire(cyclic, from("second", "first", "value"));
  for (const [name, doc] of [["unwired", unwired], ["mixed", mixed], ["cyclic", cyclic]]) {
    for (const connection of [from("first", "input", "Text"), from("first", "cast", "value"),
      from("first", "third", "value"), from("first", "third", switchGateInput("gate"))]) {
      assert.equal(accepts(doc, connection), false, `${name}: ${JSON.stringify(connection)}`);
    }
  }
});

Then("Switch operands match the main type with numeric comparisons in either direction", function () {
  for (const main of scalars) {
    const doc = fixture();
    wire(doc, into(main, "first"));
    for (const operand of types) assert.equal(accepts(doc, into(operand, "first", switchGateInput("gate"))),
      scalars.includes(operand) && comparable(operand, main), `${operand} compared with ${main}`);
  }
});

Then("an operand wired first constrains its subsequent Switch main input", function () {
  const empty = fixture();
  for (const operand of types) assert.equal(accepts(empty, into(operand, "first", switchGateInput("gate"))),
    scalars.includes(operand), `unwired main with ${operand} operand`);
  for (const operand of scalars) {
    const doc = fixture();
    wire(doc, into(operand, "first", switchGateInput("gate")));
    for (const main of types) assert.equal(accepts(doc, into(main, "first")),
      scalars.includes(main) && comparable(operand, main), `${main} main after ${operand} operand`);
  }
});

Then("incoming Switch values preserve compatibility throughout downstream Switch chains", function () {
  for (const downstream of ["first", "third"]) for (const main of scalars) for (const target of known) {
    const doc = fixture();
    wire(doc, from("first", "second", "value"));
    wire(doc, from("second", "third", "value"));
    wire(doc, from(downstream, "input", target));
    assert.equal(accepts(doc, into(main, "first")), compatible(main, target), `${main} via ${downstream} to ${target}`);
  }
  for (const operand of scalars) for (const main of scalars) {
    const doc = fixture();
    wire(doc, from("first", "second", "value"));
    wire(doc, into(operand, "second", switchGateInput("gate")));
    assert.equal(accepts(doc, into(main, "first")), comparable(operand, main), `${main} to downstream ${operand} operand`);
  }
  const cast = fixture();
  wire(cast, from("first", "cast", "value"));
  wire(cast, from("cast", "input", "Text"));
  assert.equal(accepts(cast, into("Integer", "first")), true, "Cast output stops type propagation");
  const converged = fixture();
  converged.nodes.find(node => node.id === "first").data.gates.push({ id: "other", operator: "==", value: "" });
  wire(converged, from("first", "second", "value"));
  wire(converged, { ...from("first", "second", "value"), sourceHandle: "other" });
  wire(converged, from("second", "input", "Integer"));
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(converged)), converged);
  assert.equal(accepts(converged, into("Integer", "first")), true, "legacy converging branches preserve their shared type");
  assert.equal(accepts(converged, into("Number", "first")), false, "legacy converging branches still protect downstream inputs");
});

Then("inactive Switch connections do not affect inferred or downstream types", function () {
  for (const flags of [{ hidden: true }, { detached: true }, { kind: "schema" }]) {
    const inferred = fixture();
    wire(inferred, into("Text", "first"), flags);
    wire(inferred, into("Integer", "first"));
    assert.equal(accepts(inferred, from("first", "input", "Integer")), true, JSON.stringify(flags));
    const downstream = fixture();
    wire(downstream, from("first", "input", "Text"), flags);
    wire(downstream, into("Text", "first", switchGateInput("gate")), flags);
    assert.equal(accepts(downstream, into("Integer", "first")), true, JSON.stringify(flags));
  }
  const hiddenSource = fixture();
  hiddenSource.nodes.find(node => node.id === "cast").hidden = true;
  wire(hiddenSource, from("cast", "first", "value"));
  wire(hiddenSource, into("Integer", "first"));
  assert.equal(accepts(hiddenSource, from("first", "input", "Integer")), true);
  const hiddenTarget = fixture();
  hiddenTarget.nodes.find(node => node.id === "second").hidden = true;
  wire(hiddenTarget, from("first", "second", "value"));
  wire(hiddenTarget, from("second", "input", "Text"));
  assert.equal(accepts(hiddenTarget, into("Integer", "first")), true);
});

Then("an unrelated legacy type mismatch does not block a compatible connection", function () {
  const doc = fixture();
  wire(doc, fieldConnection("Text", "Integer"));
  wire(doc, into("Integer", "second"));
  wire(doc, into("Text", "second"));
  wire(doc, from("second", "input", "Number"));
  assert.equal(accepts(doc, fieldConnection("Boolean", "Boolean")), true);
  assert.equal(accepts(doc, into("Integer", "first")), true);
});

Then("saved workflows with old type mismatches still import without losing edges", function () {
  for (const [source, target] of [["Integer", "Text"], ["Number", "Integer"], ["Object", "Array"]]) {
    const doc = fixture();
    wire(doc, fieldConnection(source, target));
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(doc)), doc, `${source} to ${target}`);
  }
  const doc = fixture();
  wire(doc, into("Integer", "first"));
  wire(doc, into("Text", "first", switchGateInput("gate")));
  wire(doc, from("first", "input", "Text"));
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(doc)), doc, "legacy Switch operand and output mismatches");
});
