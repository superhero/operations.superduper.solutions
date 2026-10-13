// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { After, Given, When, Then } from "@cucumber/cucumber";
import { createWorkerClient } from "./lib/worker-rpc.ts";
import { applicationExecutionMetrics } from "./lib/application-workers.ts";

class RoutingWorkerDouble extends EventTarget {
  messages = [];
  terminations = 0;
  postMessage(message) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminations++; }
  reply(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

function trackedClient(world) {
  world.originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  world.workerBaseline = applicationExecutionMetrics();
  world.routingWorker = new RoutingWorkerDouble();
  world.workerFactories = 0;
  world.workerClient = createWorkerClient(() => { world.workerFactories++; return world.routingWorker; });
  world.workerEvents = [];
  world.workerClient.subscribe(event => world.workerEvents.push(event));
  assert.deepEqual(applicationExecutionMetrics(), world.workerBaseline, "constructing a client starts no worker");
  return world.workerClient;
}

After({ tags: "@flow-routing-worker-lifecycle" }, function () {
  this.workerClient?.dispose(true);
  if (this.originalWindow) Object.defineProperty(globalThis, "window", this.originalWindow);
  else delete globalThis.window;
});

Given("a tracked routing worker with two pending calculations", function () {
  const client = trackedClient(this);
  this.routingResults = Promise.allSettled([
    client.call("calculate", [{ sceneRevision: 1 }]),
    client.call("calculate", [{ sceneRevision: 2 }]),
  ]);
  assert.equal(this.workerFactories, 1);
  assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.workerBaseline.dedicatedWorkers + 1);
});

When("the routing owner disposes its worker immediately", function () {
  this.workerClient.dispose(true);
  this.metricsAtDisposal = applicationExecutionMetrics();
  this.terminationsAtDisposal = this.routingWorker.terminations;
});

Then("both calculations abort and the worker is terminated and untracked before any reply", async function () {
  assert.equal(this.terminationsAtDisposal, 1);
  assert.deepEqual(this.metricsAtDisposal, this.workerBaseline);
  const results = await this.routingResults;
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.ok(result.reason instanceof DOMException);
    assert.equal(result.reason.name, "AbortError");
  }
});

Then("later replies events and calls cannot reactivate the disposed routing worker", async function () {
  this.routingWorker.reply({ kind: "result", id: 1, value: "late route" });
  this.routingWorker.reply({ kind: "event", event: { type: "change", data: "late event" } });
  await assert.rejects(this.workerClient.call("calculate"), /has been closed/);
  this.workerClient.dispose(true);
  assert.equal(this.workerFactories, 1);
  assert.equal(this.routingWorker.terminations, 1);
  assert.equal(this.routingWorker.messages.length, 2);
  assert.deepEqual(this.workerEvents, []);
  assert.deepEqual(applicationExecutionMetrics(), this.workerBaseline);
});

Given("a tracked repository worker with a pending save", function () {
  this.saving = trackedClient(this).call("save", [{ id: "workflow" }]);
});

When("the repository owner disposes its worker normally", function () {
  this.workerClient.dispose();
});

Then("the worker remains tracked until the accepted save completes", async function () {
  assert.equal(this.routingWorker.terminations, 0);
  assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.workerBaseline.dedicatedWorkers + 1);
  await assert.rejects(this.workerClient.call("save"), /has been closed/);
});

Then("the save completes before its worker is terminated and untracked", async function () {
  this.routingWorker.reply({ kind: "result", id: 1, value: "committed" });
  assert.equal(await this.saving, "committed");
  assert.equal(this.routingWorker.terminations, 1);
  assert.deepEqual(applicationExecutionMetrics(), this.workerBaseline);
});
