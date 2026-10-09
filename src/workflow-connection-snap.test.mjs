// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { nearestWorkflowInput } from "./lib/workflow-connection-snap.ts";

function port(id, y) {
  return { id, nodeId: "target", type: "target", position: "left", x: -6, y, width: 12, height: 12 };
}
function panel(id = "target", z = 0) {
  return { id, position: { x: 100, y: 100 }, data: {}, measured: { width: 200, height: 150 },
    internals: { z, positionAbsolute: { x: 100, y: 100 }, handleBounds: {
      target: [port("nearest", 10), port("farthest", 100), port("middle", 60)]
    } } };
}
function fixture() {
  return { origin: { fromNode: panel("source"), fromHandle: { id: "output", type: "source" },
    inProgress: true, isValid: null }, nodes: [panel()], pointer: { x: 140, y: 116 } };
}
function resolve({ origin, nodes, pointer }, validate = () => true, available) {
  return nearestWorkflowInput(origin, nodes, pointer, validate, available);
}

Given("an output drag over a panel with several input fields", function () { this.snap = fixture(); });
When("the nearby ports include hidden, disabled, structural, and rejected inputs", function () {
  this.snap.nodes[0].internals.handleBounds.target.unshift(port("hidden", 10), port("disabled", 11), port("value", 12));
  this.validated = [];
  this.target = resolve(this.snap, connection => {
    this.validated.push(connection.targetHandle);
    return !["value", "nearest"].includes(connection.targetHandle);
  }, (_, handle) => !["hidden", "disabled"].includes(handle.id));
});
Then("snapping selects the nearest available valid field with its exact connection and coordinates", function () {
  assert.deepEqual(this.target.connection, { source: "source", sourceHandle: "output", target: "target", targetHandle: "middle" });
  assert.equal(this.target.node, this.snap.nodes[0]);
  assert.equal(this.target.handle, this.snap.nodes[0].internals.handleBounds.target.at(-1));
  assert.deepEqual(this.target.point, { x: 100, y: 166 });
  assert.deepEqual(this.validated, ["value", "nearest", "farthest", "middle"]);
  // Keeping a nearer candidate also matters when the remaining handles are farther away.
  assert.equal(resolve(fixture()).connection.targetHandle, "nearest");
});

const origins = {
  "missing source": snap => { snap.origin.fromNode = null; },
  "missing source handle": snap => { snap.origin.fromHandle = null; },
  "input origin": snap => { snap.origin.fromHandle.type = "target"; },
  "ended drag": snap => { snap.origin.inProgress = false; },
  "native valid snap": snap => { snap.origin.isValid = true; },
  "hidden source": snap => { snap.origin.fromNode.hidden = true; },
  "unconnectable source": snap => { snap.origin.fromNode.connectable = false; },
  "nonfinite pointer x": snap => { snap.pointer.x = NaN; },
  "nonfinite pointer y": snap => { snap.pointer.y = Infinity; }
};
Then("these connection origins do not produce a body snap:", function (table) {
  for (const { state } of table.hashes()) {
    const snap = fixture();
    origins[state](snap);
    assert.equal(resolve(snap, () => assert.fail(`Unexpected validation for ${state}`)), null, state);
  }
});

const panels = {
  "missing panel": snap => { snap.nodes = [undefined]; },
  "source panel": snap => { snap.nodes[0].id = "source"; },
  "hidden panel": snap => { snap.nodes[0].hidden = true; },
  "unconnectable panel": snap => { snap.nodes[0].connectable = false; },
  "unmeasured width": snap => { delete snap.nodes[0].measured.width; },
  "unmeasured height": snap => { delete snap.nodes[0].measured.height; },
  "zero width": snap => { snap.nodes[0].measured.width = 0; },
  "zero height": snap => { snap.nodes[0].measured.height = 0; },
  "nonfinite geometry": snap => { snap.nodes[0].internals.positionAbsolute.x = Infinity; },
  "pointer left": snap => { snap.pointer.x = 99; },
  "pointer right": snap => { snap.pointer.x = 301; },
  "pointer above": snap => { snap.pointer.y = 99; },
  "pointer below": snap => { snap.pointer.y = 251; },
  "no handle bounds": snap => { delete snap.nodes[0].internals.handleBounds; },
  "no target handles": snap => { snap.nodes[0].internals.handleBounds.target = null; }
};
Then("these panels do not produce a body snap:", function (table) {
  for (const { state } of table.hashes()) {
    const snap = fixture();
    panels[state](snap);
    assert.equal(resolve(snap, () => assert.fail(`Unexpected validation for ${state}`)), null, state);
  }
});

const ports = {
  "wrong direction": handle => { handle.type = "source"; },
  "zero width": handle => { handle.width = 0; },
  "zero height": handle => { handle.height = 0; },
  "nonfinite geometry": handle => { handle.x = Infinity; }
};
Then("these ports are skipped while another usable input remains selectable:", function (table) {
  for (const { state } of table.hashes()) {
    const snap = fixture();
    ports[state](snap.nodes[0].internals.handleBounds.target[0]);
    assert.equal(resolve(snap, connection => {
      assert.notEqual(connection.targetHandle, "nearest", state);
      return true;
    }).connection.targetHandle, "middle", state);
  }
});

Then("the highest valid panel wins regardless of iteration order", function () {
  const lower = panel("lower", 0), higher = panel("higher", 2);
  higher.internals.handleBounds.target = [port("farther", 100)];
  for (const nodes of [[lower, higher], [higher, lower]])
    assert.equal(resolve({ ...this.snap, nodes }).connection.target, "higher");
});
Then("a higher panel without valid fields does not mask a lower panel", function () {
  const lower = panel("lower", 0), higher = panel("higher", 2);
  for (const nodes of [[lower, higher], [higher, lower]])
    assert.equal(resolve({ ...this.snap, nodes }, connection => connection.target === "lower").connection.target, "lower");
  assert.equal(resolve({ ...this.snap, nodes: [higher] }, () => false), null);
});
Then("panels with equal stacking order use their display order", function () {
  const first = panel("first"), last = panel("last");
  assert.equal(resolve({ ...this.snap, nodes: [first, last] }).connection.target, "last");
});
Then("an unset stacking order behaves as zero", function () {
  const defaultPanel = panel("default");
  delete defaultPanel.internals.z;
  assert.equal(resolve({ ...this.snap, nodes: [panel("behind", -1), defaultPanel] }).connection.target, "default");
});
Then("unnamed handles resolve to null identifiers", function () {
  delete this.snap.origin.fromHandle.id;
  this.snap.nodes[0].internals.handleBounds.target = [port(undefined, 10)];
  assert.deepEqual(resolve(this.snap).connection,
    { source: "source", sourceHandle: null, target: "target", targetHandle: null });
});
Then("a final drag state uses the same target as its preview state", function () {
  const expected = resolve(this.snap);
  delete this.snap.origin.inProgress;
  assert.deepEqual(resolve(this.snap), expected);
});
