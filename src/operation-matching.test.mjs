// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { After, Before, Then } from "@cucumber/cucumber";
import { operations } from "./lib/catalog.ts";
import { evaluateOperations, evaluatePreparedOperations, prepareMatchingOperations } from "./lib/matching.ts";
import { createMatchingLibrary } from "./lib/matching-index.ts";
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
  library = createMatchingLibrary();
  postMessage(message) {
    this.messages.push(structuredClone(message));
    if (message.method === 'configure') {
      this.library.configure(...message.args);
      this.reply({ kind: 'result', id: message.id });
    }
  }
  terminate() { this.terminations++; }
  reply(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
  complete() {
    const request = this.messages.at(-1);
    if (request.method !== 'search') return;
    const [query, revision, details] = request.args;
    const result = evaluatePreparedOperations(query, this.library.read(revision));
    const scores = matches => matches.map(({ operation, similarity }) => ({ id: operation.id, similarity }));
    this.reply({ kind: "result", id: request.id, value: {
      considered: result.candidates.length, results: scores(result.results), candidates: details ? scores(result.candidates) : [],
    } });
  }
}

Before({ tags: "@operation-matching" }, function () {
  this.matchingControllers = [];
  this.matchingEvaluators = [];
  this.matchingWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  this.matchingWorkerBaseline = applicationExecutionMetrics().dedicatedWorkers;
  this.matchingFactoryDescriptor = Object.getOwnPropertyDescriptor(globalThis, factoryKey);
});

After({ tags: "@operation-matching" }, function () {
  try {
    for (const controller of this.matchingControllers) controller.abort();
    for (const evaluate of this.matchingEvaluators) evaluate.dispose();
    evaluateOperationsAsync.dispose();
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

function evaluator(world, factory) {
  const evaluate = createOperationMatchingEvaluator(factory);
  world.matchingEvaluators.push(evaluate);
  return evaluate;
}
async function searching(worker) {
  await Promise.resolve();
  assert.equal(worker.messages.at(-1).method, 'search');
}
function start(world, query, worker = new MatchingWorkerDouble()) {
  const controller = signal(world);
  const pending = evaluator(world, () => worker)(query, operations, controller.signal);
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
  assert.equal(worker.messages[0].method, 'configure');
  const [updates, active, revision] = worker.messages[0].args;
  assert.deepEqual(updates.flatMap(catalog => catalog.prepared), prepareMatchingOperations(operations.map(({ id, name }) => ({ id, name }))));
  assert.deepEqual(updates.map(catalog => catalog.id), active);
  assert.equal(applicationExecutionMetrics().dedicatedWorkers, this.matchingWorkerBaseline + 1);
  await searching(worker);
  assert.deepEqual(worker.messages[1].args, ["List projetcs", revision, true]);
  worker.complete();
  const { durationMs, considered, ...evaluation } = await pending;
  assert.equal(considered, operations.length);
  assert.deepEqual(evaluation, evaluateOperations("List projetcs", operations));
  assert.ok(Number.isFinite(durationMs) && durationMs >= 0);
  for (const match of evaluation.candidates)
    assert.equal(match.operation, operations.find(operation => operation.id === match.operation.id));
  for (const match of evaluation.results) assert.ok(evaluation.candidates.includes(match));
  assert.equal(worker.terminations, 0);
  const compact = evaluateOperationsAsync('Create task', operations, signal(this).signal, false);
  assert.equal(worker.messages.filter(message => message.method === 'configure').length, 1);
  worker.complete();
  const result = await compact;
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.results, evaluateOperations('Create task', operations).results);
  assert.equal(result.considered, operations.length);
  assert.equal(worker.terminations, 0);
});

Then("an already aborted operation search never starts its worker", async function () {
  const controller = signal(this);
  controller.abort();
  let starts = 0;
  const evaluate = evaluator(this, () => { starts++; return new MatchingWorkerDouble(); });
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
  await searching(replacement.worker);
  replacement.worker.complete();
  await assert.rejects(previous.pending, { name: "AbortError" });
  const latest = await replacement.pending;
  assert.equal(latest.results[0].operation.id, "demo:createTask");
  assert.equal(previous.worker.terminations, 1);
  assert.equal(replacement.worker.terminations, 0);
});

Then("an operation search aborted after its worker reply cannot publish that reply", async function () {
  const { worker, controller, pending } = start(this, "List projects");
  await searching(worker);
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
  await assert.rejects(evaluator(this, () => { throw failure; })("List projects", operations, controller.signal), failure);
  assert.equal(listenerRemovals.length, 1);
  assert.equal(listenerRemovals[0][0], "abort");
});

Then("operation matching preserves remote failures and releases crashed workers", async function () {
  const remote = start(this, "List projects");
  await searching(remote.worker);
  remote.worker.reply({ kind: "error", id: remote.worker.messages.at(-1).id, error: { name: "EvaluationError", message: "Could not compare operations",
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
    const configured = [{ id: 'all', revision: '1', prepared: prepareMatchingOperations(descriptors) }];
    await handler({ data: { kind: 'request', id: 99, method: 'configure', args: [configured, ['all'], 'snapshot'] } });
    for (const [index, query] of ["List projetcs", "xylophone nebula", "", "x".repeat(257)].entries()) {
      await handler({ data: { kind: "request", id: index, method: "evaluate", args: [query, descriptors] } });
      const expected = evaluateOperations(query, operations);
      const compact = matches => matches.map(({ operation, similarity }) => ({ operation: { id: operation.id, name: operation.name }, similarity }));
      assert.deepEqual(replies.at(-1), { kind: "result", id: index, value: {
        candidates: compact(expected.candidates), results: compact(expected.results),
      } });
      await handler({ data: { kind: 'request', id: index + 10, method: 'evaluatePrepared', args: [query, prepareMatchingOperations(descriptors)] } });
      assert.deepEqual(replies.at(-1), { kind: 'result', id: index + 10, value: {
        candidates: expected.candidates.map(({ operation, similarity }) => ({ id: operation.id, similarity })),
        results: expected.results.map(match => match.operation.id),
      } });
      for (const details of [true, false]) {
        await handler({ data: { kind: 'request', id: 30 + index, method: 'search', args: [query, 'snapshot', details] } });
        const scores = matches => matches.map(({ operation, similarity }) => ({ id: operation.id, similarity }));
        assert.deepEqual(replies.at(-1), { kind: 'result', id: 30 + index, value: {
          considered: expected.candidates.length, results: scores(expected.results), candidates: details ? scores(expected.candidates) : [],
        } });
      }
    }
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

Then('matching reuses unchanged schema indexes and reinstalls them after an idle crash', async function () {
  const workers = [];
  const evaluate = evaluator(this, () => { const worker = new MatchingWorkerDouble(); workers.push(worker); return worker; });
  const firstController = signal(this);
  const first = evaluate('List projects', operations, firstController.signal, false);
  await searching(workers[0]); workers[0].complete(); await first;
  firstController.abort();
  assert.equal(workers[0].terminations, 0, 'A completed request must not terminate the reusable worker.');
  const changed = operations.map(operation => operation.id.startsWith('demo:') ? { ...operation, name: `${operation.name} renamed` } : operation);
  const second = evaluate('renamed', changed, signal(this).signal);
  assert.deepEqual(workers[0].messages.at(-1).args[0].map(catalog => catalog.id), ['demo']);
  await searching(workers[0]); workers[0].complete();
  assert.deepEqual((await second).results, evaluateOperations('renamed', changed).results);
  workers[0].dispatchEvent(new Event('messageerror'));
  assert.equal(workers[0].terminations, 1);
  const third = evaluate('List projects', changed, signal(this).signal, false);
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].messages[0].args[0].map(catalog => catalog.id), ['demo', 'httpbin']);
  await searching(workers[1]); workers[1].complete(); await third;
  workers[1].dispatchEvent(new Event('error'));
  const fourth = evaluate('Create task', changed, signal(this).signal, false);
  assert.equal(workers.length, 3);
  await searching(workers[2]); workers[2].complete(); await fourth;
  evaluate.dispose();
  evaluate.dispose();
  assert.equal(workers[1].terminations, 1);
  assert.equal(workers[2].terminations, 1);
});

Then('a replacement search wins even without an explicit caller abort', async function () {
  const workers = [];
  const evaluate = evaluator(this, () => { const worker = new MatchingWorkerDouble(); workers.push(worker); return worker; });
  const oldController = signal(this);
  const obsolete = evaluate('List projects', operations, oldController.signal);
  const rejected = assert.rejects(obsolete, { name: 'AbortError' });
  const latest = evaluate('Create task', operations, signal(this).signal);
  await searching(workers[1]);
  workers[0].complete(); workers[1].complete();
  assert.equal((await latest).results[0].operation.id, 'demo:createTask');
  await rejected;
  assert.equal(workers[0].terminations, 1);
  const controller = signal(this);
  const previous = evaluate('List projects', operations, controller.signal);
  const cancelled = assert.rejects(previous, { name: 'AbortError' });
  const replacement = evaluate('Create task', operations, signal(this).signal);
  controller.abort();
  await searching(workers[2]); workers[2].complete();
  await replacement; await cancelled;
  assert.equal(workers[2].terminations, 0, 'Aborting an older owner cannot stop its replacement.');
});
