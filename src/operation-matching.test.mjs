// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { After, Before, Then } from "@cucumber/cucumber";
import { operations } from "./lib/catalog.ts";
import { evaluateOperations } from "./lib/matching.ts";
import { applicationExecutionMetrics } from "./lib/application-workers.ts";

// Resolve only Vite's constructor adapter; exercise the real client and RPC.
const factoryKey = Symbol.for("operations.matching.test.worker-factory");
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "./operation-matching.worker.ts?worker&inline"
      && context.parentURL === new URL("./lib/operation-matching-client.ts", import.meta.url).href
      ? { url: "test:operation-matching-worker", shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === "test:operation-matching-worker" ? { format: "module", shortCircuit: true,
      source: `export default class { constructor(options) { return globalThis[Symbol.for("operations.matching.test.worker-factory")](options); } }` }
      : next(url, context);
  },
});
let createOperationMatchingEvaluator, evaluateOperationsAsync;
try {
  ({ createOperationMatchingEvaluator, evaluateOperationsAsync } = await import("./lib/operation-matching-client.ts"));
} finally { hooks.deregister(); }

class MatchingWorkerDouble extends EventTarget {
  messages = [];
  terminations = 0;
  postMessage(message) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminations++; }
  reply(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
  complete() {
    const request = this.messages.at(-1);
    this.reply({ kind: "result", id: request.id, value: evaluateOperations(...request.args) });
  }
}

Before({ tags: "@operation-matching" }, function () {
  this.matchingControllers = [];
  this.matchingWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  this.matchingWorkerBaseline = applicationExecutionMetrics().dedicatedWorkers;
  this.matchingFactoryDescriptor = Object.getOwnPropertyDescriptor(globalThis, factoryKey);
});

After({ tags: "@operation-matching" }, function () {
  try {
    for (const controller of this.matchingControllers) controller.abort();
    assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.matchingWorkerBaseline);
  } finally {
    if (this.matchingFactoryDescriptor) Object.defineProperty(globalThis, factoryKey, this.matchingFactoryDescriptor);
    else delete globalThis[factoryKey];
    if (this.matchingWindowDescriptor) Object.defineProperty(globalThis, "window", this.matchingWindowDescriptor);
    else delete globalThis.window;
  }
});

function signal(world) {
  const controller = new AbortController();
  world.matchingControllers.push(controller);
  return controller;
}

function start(world, query, worker = new MatchingWorkerDouble()) {
  const controller = signal(world);
  const pending = createOperationMatchingEvaluator(() => worker)(query, operations, controller.signal);
  // Teardown may abort the request following an earlier failed assertion.
  pending.catch(() => {});
  return { controller, pending, worker };
}

Then("background matching sends only identifiers and names and restores the complete matching operations", async function () {
  const worker = new MatchingWorkerDouble();
  globalThis[factoryKey] = options => {
    assert.deepEqual(options, { name: "operation-matching" });
    return worker;
  };
  const pending = evaluateOperationsAsync("List projetcs", operations, signal(this).signal);
  pending.catch(() => {});
  assert.deepEqual(worker.messages[0].args, ["List projetcs", operations.map(({ id, name }) => ({ id, name }))]);
  assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.matchingWorkerBaseline + 1);
  worker.complete();
  const { durationMs, ...evaluation } = await pending;
  assert.deepEqual(evaluation, evaluateOperations("List projetcs", operations));
  assert.ok(Number.isFinite(durationMs) && durationMs >= 0);
  for (const match of evaluation.candidates)
    assert.equal(match.operation, operations.find(operation => operation.id === match.operation.id));
  for (const match of evaluation.results) assert.ok(evaluation.candidates.includes(match));
  assert.equal(worker.terminations, 1);
});

Then("an already aborted operation search never starts its worker", async function () {
  const controller = signal(this);
  controller.abort();
  let starts = 0;
  const evaluate = createOperationMatchingEvaluator(() => { starts++; return new MatchingWorkerDouble(); });
  await assert.rejects(evaluate("List projects", operations, controller.signal), { name: "AbortError" });
  assert.equal(starts, 0);
});

Then("replacing an operation search terminates its worker and only the replacement can complete", async function () {
  const previous = start(this, "List projects");
  previous.controller.abort();
  assert.equal(previous.worker.terminations, 1);
  assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.matchingWorkerBaseline);
  const replacement = start(this, "Create task");
  previous.worker.complete();
  replacement.worker.complete();
  await assert.rejects(previous.pending, { name: "AbortError" });
  const latest = await replacement.pending;
  assert.equal(latest.results[0].operation.id, "demo:createTask");
  assert.equal(previous.worker.terminations, 1);
  assert.equal(replacement.worker.terminations, 1);
});

Then("an operation search aborted after its worker reply cannot publish that reply", async function () {
  const { worker, controller, pending } = start(this, "List projects");
  worker.complete();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(worker.terminations, 1);
});

Then("operation matching rejects a worker startup failure and removes its cancellation listener", async function () {
  const controller = signal(this);
  const listenerRemovals = [];
  const removeEventListener = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { listenerRemovals.push(args); removeEventListener(...args); };
  const failure = new Error("Matching worker failed to start");
  await assert.rejects(createOperationMatchingEvaluator(() => { throw failure; })("List projects", operations, controller.signal), failure);
  assert.equal(listenerRemovals.length, 1);
  assert.equal(listenerRemovals[0][0], "abort");
});

Then("operation matching preserves remote failures and releases crashed workers", async function () {
  const remote = start(this, "List projects");
  remote.worker.reply({ kind: "error", id: 1, error: { name: "EvaluationError", message: "Could not compare operations",
    cause: { name: "TypeError", message: "Invalid operation name" } } });
  await assert.rejects(remote.pending, error => error.name === "EvaluationError" && error.cause.name === "TypeError");
  assert.equal(remote.worker.terminations, 1);

  const crashed = start(this, "Create task");
  crashed.worker.dispatchEvent(Object.assign(new Event("error"), { message: "Matching worker stopped" }));
  await assert.rejects(crashed.pending, { name: "WorkerError", message: "Matching worker stopped" });
  assert.equal(crashed.worker.terminations, 1);
});

Then("the operation matching worker evaluates compact descriptors with the normal ranking rules", async function () {
  const originals = ["addEventListener", "postMessage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  let handler;
  const replies = [];
  globalThis.addEventListener = (_type, listener) => { handler = listener; };
  globalThis.postMessage = value => replies.push(value);
  try {
    await import("./lib/operation-matching.worker.ts");
    const descriptors = operations.map(({ id, name }) => ({ id, name }));
    for (const [index, query] of ["List projetcs", "xylophone nebula", "", "x".repeat(257)].entries()) {
      await handler({ data: { kind: "request", id: index, method: "evaluate", args: [query, descriptors] } });
      const expected = evaluateOperations(query, operations);
      const compact = matches => matches.map(({ operation, similarity }) => ({ operation: { id: operation.id, name: operation.name }, similarity }));
      assert.deepEqual(replies.at(-1), { kind: "result", id: index, value: {
        candidates: compact(expected.candidates), results: compact(expected.results),
      } });
    }
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
