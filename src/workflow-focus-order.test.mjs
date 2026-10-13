// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { orderWorkflowNodes, restoreWorkflowNodeOrder } from "./lib/workflow-focus-order.ts";

const owner = (id, type = "operation") => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const panel = (id, ownerId, direction, fields = []) => ({ id, type: "data", position: { x: 0, y: 0 },
  data: { ownerId, direction, fields: fields.map(id => ({ id })) } });
const schema = (parent, child, handle = `schema:${child.id}`) => ({ id: `schema:${child.id}`, kind: "schema",
  source: child.data.direction === "inputs" ? child.id : parent.id,
  target: child.data.direction === "inputs" ? parent.id : child.id,
  sourceHandle: child.data.direction === "inputs" ? "value" : handle,
  targetHandle: child.data.direction === "inputs" ? handle : "value" });
const ids = nodes => nodes.map(node => node.id);

Given("workflow operations with nested input and output branches in shuffled edge order", function () {
  const operation = owner("operation"), next = owner("next");
  const input = panel("input", operation.id, "inputs", ["first", "second"]);
  const inputSecond = panel("input-second", operation.id, "inputs");
  const inputFirst = panel("input-first", operation.id, "inputs", ["deep"]);
  const inputDeep = panel("input-deep", operation.id, "inputs");
  const inputOther = panel("input-other", operation.id, "inputs");
  const output = panel("output", operation.id, "outputs", ["first", "second"]);
  const outputSecond = panel("output-second", operation.id, "outputs");
  const outputFirst = panel("output-first", operation.id, "outputs", ["deep"]);
  const outputDeep = panel("output-deep", operation.id, "outputs");
  const nextInput = panel("next-input", next.id, "inputs"), nextOutput = panel("next-output", next.id, "outputs");
  inputFirst.hidden = true;
  inputDeep.hidden = true;
  this.focusNodes = [operation, input, inputSecond, inputFirst, inputDeep, inputOther, output, outputSecond,
    outputFirst, outputDeep, next, nextInput, nextOutput];
  this.focusEdges = [schema(operation, inputOther), schema(input, inputSecond, "second"), schema(input, inputFirst, "first"),
    schema(operation, input), schema(inputFirst, inputDeep, "deep"), schema(output, outputSecond, "second"),
    schema(output, outputFirst, "first"), schema(operation, output), schema(outputFirst, outputDeep, "deep"),
    schema(next, nextOutput), schema(next, nextInput)];
  this.focusEdges.find(edge => edge.target === input.id && edge.source === inputFirst.id).detached = true;
  this.focusBefore = structuredClone(this.focusNodes);
});
When("workflow nodes are ordered for keyboard focus", function () {
  this.focusOrdered = orderWorkflowNodes(this.focusNodes, this.focusEdges);
});
Then("each operation follows schema depth and field order without moving or replacing nodes", function () {
  assert.deepEqual(ids(this.focusOrdered), ["input-deep", "input-first", "input-second", "input", "input-other", "operation",
    "output", "output-first", "output-second", "output-deep", "next-input", "next", "next-output"]);
  assert.deepEqual(this.focusNodes, this.focusBefore);
  for (const node of this.focusOrdered) assert.equal(node, this.focusNodes.find(original => original.id === node.id));
});
Then("hidden schema branches remain in the ordered document", function () {
  assert.deepEqual(ids(this.focusOrdered.filter(node => node.hidden)), ["input-deep", "input-first"]);
});
Then("dragging nodes does not change their keyboard focus order", function () {
  const moved = this.focusNodes.map((node, index) => ({ ...node, position: { x: -index * 100, y: index * 200 } }));
  assert.deepEqual(ids(orderWorkflowNodes(moved, this.focusEdges)), ids(this.focusOrdered));
});

Given("workflow references and standalone utilities among operations", function () {
  const before = owner("before"); delete before.type;
  const comment = owner("comment", "comment"), nested = owner("nested", "workflow");
  const input = panel("nested-input", nested.id, "inputs"), output = panel("nested-output", nested.id, "outputs");
  const cast = owner("cast", "cast"), gate = owner("gate", "switch"), after = owner("after");
  this.focusNodes = [before, comment, nested, output, input, cast, gate, after];
  this.focusEdges = [schema(nested, output), schema(nested, input)];
});
Then("references use their interface order and utilities retain their document order", function () {
  assert.deepEqual(ids(this.focusOrdered), ["before", "comment", "nested-input", "nested", "nested-output", "cast", "gate", "after"]);
});

Given("workflow nodes with cyclic mappings, invalid schema attachments, and orphan branches", function () {
  const first = owner("first"), second = owner("second");
  const input = panel("input", first.id, "inputs", ["child"]);
  const child = panel("child", first.id, "inputs", ["parent"]);
  const orphan = panel("orphan", first.id, "inputs");
  const unknownOwner = panel("unknown-owner", "missing", "outputs");
  const wrongOwner = panel("wrong-owner", second.id, "inputs");
  const wrongDirection = panel("wrong-direction", first.id, "outputs");
  const unnamedFirst = panel("unnamed-first", first.id, "inputs");
  const unnamedSecond = panel("unnamed-second", first.id, "inputs");
  this.focusNodes = [orphan, first, input, child, unknownOwner, wrongOwner, wrongDirection, unnamedFirst, unnamedSecond, second];
  this.focusEdges = [schema(first, input), schema(input, child, "child"), schema(child, input, "parent"),
    schema(input, child, "child"), schema(input, unnamedSecond, "missing-second"), schema(input, unnamedFirst, "missing-first"),
    { id: "mapping-first", kind: "mapping", source: first.id, target: second.id },
    { id: "mapping-second", kind: "mapping", source: second.id, target: first.id },
    { id: "legacy", source: first.id, target: second.id },
    schema(first, unknownOwner), schema(first, wrongOwner), schema(input, wrongOwner, "child"),
    schema(input, wrongDirection, "child"), schema(owner("missing"), unknownOwner),
    { id: "missing-target", kind: "schema", source: first.id, target: "missing" },
    { id: "missing-source", kind: "schema", source: "missing", target: input.id },
    { id: "bad-direction", kind: "schema", source: first.id, target: input.id },
    { id: "bad-child", kind: "schema", source: first.id, target: second.id }];
});
Then("valid schema branches precede stable orphan fallbacks without duplicate nodes", function () {
  assert.deepEqual(ids(this.focusOrdered), ["child", "unnamed-first", "unnamed-second", "input", "first", "second",
    "orphan", "unknown-owner", "wrong-owner", "wrong-direction"]);
  assert.equal(new Set(ids(this.focusOrdered)).size, this.focusNodes.length);
  assert.deepEqual(new Set(this.focusOrdered), new Set(this.focusNodes));
});

Given("a canonical workflow document order", function () {
  this.focusCanonical = [{ id: "first", selected: false }, { id: "removed" }, { id: "last", selected: false }];
});
When("rendered nodes arrive reordered with replacements, removals, and additions", function () {
  this.focusUpdated = [{ id: "new-second" }, { id: "last", selected: true }, { id: "first", selected: true }, { id: "new-first" }];
  this.focusRestored = restoreWorkflowNodeOrder(this.focusCanonical, this.focusUpdated);
});
Then("the updated document keeps its surviving order and appends new nodes", function () {
  assert.deepEqual(ids(this.focusRestored), ["first", "last", "new-second", "new-first"]);
  for (const node of this.focusRestored) assert.equal(node, this.focusUpdated.find(updated => updated.id === node.id));
  assert.deepEqual(ids(this.focusCanonical), ["first", "removed", "last"]);
  assert.equal(this.focusCanonical[0].selected, false);
  assert.deepEqual(ids(this.focusUpdated), ["new-second", "last", "first", "new-first"]);
});
Then("empty node collections remain supported", function () {
  assert.deepEqual(orderWorkflowNodes([], []), []);
  assert.deepEqual(restoreWorkflowNodeOrder([], []), []);
  assert.deepEqual(restoreWorkflowNodeOrder(this.focusCanonical, []), []);
  assert.deepEqual(restoreWorkflowNodeOrder([], this.focusUpdated), this.focusUpdated);
});
