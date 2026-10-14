// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { subscribeApplicationErrors } from "./lib/error-diagnostics.ts";
import { installRuntimeErrorCapture } from "./lib/error-capture.ts";
import { trackApplicationWorker } from "./lib/application-workers.ts";
import { createWorkerClient } from "./lib/worker-rpc.ts";
import { logger } from "./lib/logger.ts";

async function observe(action) {
  const records = [];
  const stop = subscribeApplicationErrors(record => records.push(record));
  try { await action(records); } finally { stop(); }
}
const event = (type, fields = {}) => Object.assign(new Event(type, { cancelable: true }), fields);
class WorkerDouble extends EventTarget {
  messages = [];
  postMessage(message) { this.messages.push(message); }
  terminate() {}
  fail(error) { this.dispatchEvent(new MessageEvent("message", { data: { kind: "error", id: this.messages.at(-1).id, error } })); }
}

Then("error history observes error logs and warnings carrying errors without recording ordinary logs", async function () {
  await observe(records => {
    const originals = { log: console.log, warn: console.warn, error: console.error };
    const calls = [];
    try {
      for (const method of Object.keys(originals)) console[method] = (...args) => calls.push([method, args]);
      logger.info("Ready");
      logger.warn("Storage may be cleared");
      logger.warn("Using defaults", new Error("Read failed"));
      logger.error("Missing configuration");
      logger.scope("storage").error(new Error("Write failed", { cause: new TypeError("Invalid record") }), { secret: "excluded" });
    } finally { Object.assign(console, originals); }
    assert.deepEqual(calls.map(([method]) => method), ["log", "warn", "warn", "error", "error"]);
    assert.deepEqual(records.map(record => record.error.message), ["Read failed", "Missing configuration", "Write failed"]);
    assert.equal(records[2].origin.scope, "operations > storage");
    assert.equal(records[2].error.cause.name, "TypeError");
    assert.ok(!JSON.stringify(records).includes("excluded"));
  });
});

Then("error history observes uncaught errors and rejections without suppressing events or recording resource loads", async function () {
  await observe(records => {
    const target = new EventTarget();
    const stop = installRuntimeErrorCapture(target);
    try {
      const runtime = event("error", { error: new RangeError("Too large"), message: "Too large", filename: "app.js", lineno: 4, colno: 7 });
      target.dispatchEvent(runtime);
      target.dispatchEvent(event("error", { message: "Script failed", filename: "external.js", lineno: 0, colno: 0 }));
      target.dispatchEvent(event("error"));
      const rejection = event("unhandledrejection", { reason: "Request interrupted" });
      target.dispatchEvent(rejection);
      assert.equal(runtime.defaultPrevented, false);
      assert.equal(rejection.defaultPrevented, false);
      assert.deepEqual(records.map(record => record.origin.source), ["runtime", "runtime", "rejection"]);
      assert.equal(records[0].error.name, "RangeError");
      assert.equal(records[0].origin.filename, "app.js");
      assert.equal(records[0].origin.line, 4);
      assert.equal(records[1].error.stack, undefined, "No stack is fabricated for a message-only event");
    } finally { stop(); }
    target.dispatchEvent(event("unhandledrejection", { reason: "After disposal" }));
    assert.equal(records.length, 3);
  });
});

Then("error history observes managed worker failures and stops observing released workers", async function () {
  await observe(records => {
    const worker = new WorkerDouble();
    const stop = trackApplicationWorker(worker, { scope: "routing" });
    worker.dispatchEvent(event("error", { error: new Error("Route failed"), filename: "worker.js", lineno: 9, colno: 2 }));
    worker.dispatchEvent(event("error", { message: "Worker stopped" }));
    worker.dispatchEvent(event("error"));
    worker.dispatchEvent(event("messageerror"));
    assert.equal(records.length, 4);
    assert.equal(records[0].origin.scope, "routing");
    assert.equal(records[0].error.message, "Route failed");
    assert.equal(records[1].error.name, "WorkerError");
    assert.match(records[2].error.message, /stopped unexpectedly/);
    assert.match(records[3].error.message, /Could not read/);
    stop(); stop();
    worker.dispatchEvent(event("error"));
    assert.equal(records.length, 4);
  });
});

Then("error history records worker operation and construction failures without retaining request arguments", async function () {
  await observe(async records => {
    const worker = new WorkerDouble();
    const client = createWorkerClient(() => worker, { scope: "schemas" });
    try {
      const pending = client.call("save", [{ token: "private-argument" }]);
      worker.fail({ name: "StorageError", message: "Save failed", stack: "worker stack", cause: { name: "QuotaExceededError", message: "Full", code: 22 } });
      await assert.rejects(pending, /Save failed/);
      assert.equal(records[0].origin.operation, "save");
      assert.equal(records[0].origin.scope, "schemas");
      assert.equal(records[0].error.cause.code, 22);
      assert.ok(!JSON.stringify(records).includes("private-argument"));
      worker.postMessage = () => { throw new DOMException("Cannot clone", "DataCloneError"); };
      await assert.rejects(client.call("save"), /Cannot clone/);
    } finally { client.dispose(true); }
    const failed = createWorkerClient(() => { throw new Error("Cannot start worker"); });
    await assert.rejects(failed.call("read"), /Cannot start worker/);
    failed.dispose();
    assert.deepEqual(records.map(record => record.error.message), ["Save failed", "Cannot clone", "Cannot start worker"]);
  });
});

Then("worker recording can be disabled for failures and cancellation never creates an error record", async function () {
  await observe(async records => {
    const worker = new WorkerDouble();
    const client = createWorkerClient(() => worker, { reportErrors: false });
    const failed = client.call("recordErrors");
    worker.fail({ name: "Error", message: "History unavailable" });
    await assert.rejects(failed, /History unavailable/);
    worker.dispatchEvent(event("error"));
    worker.dispatchEvent(event("messageerror"));
    worker.postMessage = () => { throw new Error("Cannot send"); };
    await assert.rejects(client.call("readErrors"), /Cannot send/);
    client.dispose(true);
    const cannotStart = createWorkerClient(() => { throw new Error("Cannot start"); }, { reportErrors: false });
    await assert.rejects(cannotStart.call("readErrors"), /Cannot start/);
    cannotStart.dispose();
    const cancellable = createWorkerClient(() => new WorkerDouble());
    const cancelled = cancellable.call("calculate");
    cancellable.dispose(true);
    await assert.rejects(cancelled, { name: "AbortError" });
    await assert.rejects(cancellable.call("calculate"), /closed/);
    assert.deepEqual(records, []);
  });
});
