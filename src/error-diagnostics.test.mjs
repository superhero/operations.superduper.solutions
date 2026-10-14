// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { describeApplicationError, reportApplicationError, subscribeApplicationErrors } from "./lib/error-diagnostics.ts";

const origin = { source: "application", scope: "operations" };

function walk(detail) {
  return [detail, ...(detail.cause ? walk(detail.cause) : []), ...(detail.errors ?? []).flatMap(walk)];
}

Then("error snapshots retain diagnostic fields without retaining application objects", function () {
  const cause = Object.assign(new TypeError("Invalid field"), { code: "INVALID_FIELD" });
  const failure = Object.assign(new AggregateError([new Error("First failure"), "Second failure"], "Save failed", { cause }), { code: 17 });
  Object.defineProperty(failure, "context", { get() { assert.fail("Application context must not be inspected"); } });
  failure.toJSON = () => assert.fail("Custom serialization must not run");
  const location = { source: "worker", scope: "workflows", operation: "save", filename: "/worker.js", line: 2, column: 0 };
  const diagnostic = describeApplicationError(failure, location);
  assert.deepEqual(diagnostic.origin, location);
  assert.deepEqual(diagnostic.error, {
    name: "AggregateError", message: "Save failed", stack: failure.stack, code: 17,
    cause: { name: "TypeError", message: "Invalid field", stack: cause.stack, code: "INVALID_FIELD" },
    errors: [
      { name: "Error", message: "First failure", stack: failure.errors[0].stack },
      { name: "ThrownValue", message: "Second failure" },
    ],
  });
  failure.message = "Later mutation";
  cause.message = "Changed cause";
  location.scope = "Changed scope";
  assert.equal(diagnostic.error.message, "Save failed");
  assert.equal(diagnostic.error.cause.message, "Invalid field");
  assert.equal(diagnostic.origin.scope, "workflows");
});

Then("error snapshots describe primitive values and incomplete error objects", function () {
  for (const value of [undefined, null, "Failed", "", 12, false, 23n, Symbol("Failure")]) {
    assert.deepEqual(describeApplicationError(value, origin).error, { name: "ThrownValue", message: String(value) });
  }
  for (const value of [{}, { name: "", message: null, stack: "", code: null }, { name: 1, message: false, stack: 9, code: Infinity }]) {
    assert.deepEqual(describeApplicationError(value, origin).error, { name: "Error", message: "Non-Error object thrown" });
  }
  assert.deepEqual(describeApplicationError(function failedOperation() {}, origin).error, { name: "failedOperation", message: "Non-Error object thrown" });
  assert.deepEqual(describeApplicationError({ message: "", code: "", cause: null, errors: [] }, origin).error, {
    name: "Error", message: "", code: "", cause: { name: "ThrownValue", message: "null" },
  });
  assert.deepEqual(describeApplicationError("Failed", { source: "unexpected", scope: "", operation: 1, filename: null, line: -1, column: NaN }).origin, { source: "application" });
  assert.deepEqual(describeApplicationError("Failed", { source: "runtime", line: 1.5, column: "1" }).origin, { source: "runtime" });
  assert.deepEqual(describeApplicationError("Failed", { source: "rejection" }).origin, { source: "rejection" });
  assert.deepEqual(describeApplicationError("Failed", null).origin, { source: "application" });
});

Then("error snapshots tolerate throwing getters and revoked proxies", function () {
  const hostile = new Proxy({}, { get() { throw new Error("Getter failed"); } });
  assert.deepEqual(describeApplicationError(hostile, hostile), {
    origin: { source: "application" }, error: { name: "Error", message: "Non-Error object thrown" },
    identity: JSON.stringify({ origin: { source: "application" }, error: { name: "Error", message: "Non-Error object thrown" } }),
  });
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.doesNotThrow(() => describeApplicationError(revoked.proxy, origin));
  assert.deepEqual(describeApplicationError({ errors: revoked.proxy }, origin).error, { name: "Error", message: "Non-Error object thrown" });
  for (const length of [-1, 1.5, Infinity, "2"]) {
    const errors = new Proxy([], { get(target, key) { return key === "length" ? length : Reflect.get(target, key); } });
    assert.equal(describeApplicationError({ errors }, origin).error.errors, undefined);
  }
  const errors = new Proxy(["hidden"], { get(target, key) { if (key === "0") throw new Error("Unavailable child"); return Reflect.get(target, key); } });
  assert.deepEqual(describeApplicationError({ errors }, origin).error.errors, [{ name: "ThrownValue", message: "undefined" }]);
});

Then("error snapshots bound text nesting aggregate children and total nodes", function () {
  const cyclic = { message: "Loop" };
  cyclic.cause = cyclic;
  assert.deepEqual(describeApplicationError(cyclic, origin).error.cause, { name: "CircularError", message: "Circular error reference" });
  let deep = { message: "Root cause" };
  for (let index = 0; index < 20; index += 1) deep = { message: `Cause ${index}`, cause: deep };
  const nested = walk(describeApplicationError(deep, origin).error);
  assert.equal(nested.length, 8);
  assert.equal(nested.at(-1).name, "TruncatedError");
  const shared = { message: "Shared cause" };
  const aggregate = describeApplicationError({ errors: Array(100).fill(shared) }, origin).error;
  assert.equal(aggregate.errors.length, 8);
  assert.ok(aggregate.errors.every(error => error.message === "Shared cause"));
  const many = { cause: { errors: Array(8).fill({ cause: "Nested failure" }) }, errors: Array(8).fill(shared) };
  assert.equal(walk(describeApplicationError(many, origin).error).length, 16);
  const exhaustive = { errors: Array(8).fill({ cause: { cause: { cause: "Nested" } } }) };
  assert.equal(walk(describeApplicationError(exhaustive, origin).error).length, 16);
  const large = "\u0000".repeat(50_000);
  const giant = describeApplicationError({ name: large, message: large, stack: large, code: large, cause: { name: large, message: large, stack: large, code: large }, errors: [large] }, { source: "worker", scope: large, operation: large, filename: large });
  assert.ok(giant.identity.length < 65_536);
  assert.ok(giant.error.message.endsWith("…"));
  assert.equal(giant.error.message.length, 2_048);
  assert.equal(giant.error.stack.length, 4_096);
  assert.equal(giant.origin.filename.length, 1_024);
  assert.equal(walk(giant.error).flatMap(error => [error.name, error.message, error.stack ?? "", typeof error.code === "string" ? error.code : ""]).join("").length + giant.origin.scope.length + giant.origin.operation.length + giant.origin.filename.length, 8_192);
});

Then("error identities are stable and distinguish changed diagnostics", function () {
  const error = { name: "SaveError", message: "Failed", stack: "save@store.ts:7", code: "E_SAVE", cause: { message: "Unavailable" } };
  const baseline = describeApplicationError(error, origin).identity;
  assert.equal(describeApplicationError({ timestamp: 123, context: { secret: true }, ...error }, { scope: "operations", source: "application" }).identity, baseline);
  for (const changed of [{ ...error, message: "Other failure" }, { ...error, stack: "save@store.ts:8" }, { ...error, code: "E_OTHER" }, { ...error, cause: { message: "Denied" } }]) {
    assert.notEqual(describeApplicationError(changed, origin).identity, baseline);
  }
  assert.notEqual(describeApplicationError(error, { ...origin, scope: "other" }).identity, baseline);
  assert.notEqual(describeApplicationError(error, { ...origin, source: "rejection" }).identity, baseline);
  assert.deepEqual(JSON.parse(baseline), { origin, error: { ...error, cause: { name: "Error", message: "Unavailable" } } });
});

Then("named worker identities ignore blob identifiers while preserving source locations", function () {
  const firstUrl = "blob:https://operations.example/11111111-1111-1111-1111-111111111111";
  const secondUrl = "blob:https://operations.example/22222222-2222-2222-2222-222222222222";
  const from = (url, line = 12) => ({ name: "WorkerError", message: "Failed", stack: `at save (${url}:${line}:3)`, cause: { message: "Cause", stack: `at store (${url}:3:4)` } });
  const worker = { source: "worker", scope: "schemas", operation: "save", filename: firstUrl, line: 12, column: 3 };
  const first = describeApplicationError(from(firstUrl), worker);
  const second = describeApplicationError(from(secondUrl), { ...worker, filename: secondUrl });
  assert.equal(first.identity, second.identity);
  assert.equal(first.error.stack, `at save (${firstUrl}:12:3)`);
  assert.equal(second.origin.filename, secondUrl);
  assert.notEqual(first.identity, describeApplicationError(from(firstUrl, 13), worker).identity);
  assert.notEqual(first.identity, describeApplicationError(from(firstUrl), { ...worker, scope: "workflows" }).identity);
  for (const unscoped of [{ source: "worker" }, { source: "runtime", scope: "schemas" }]) {
    assert.notEqual(describeApplicationError(from(firstUrl), unscoped).identity, describeApplicationError(from(secondUrl), unscoped).identity);
  }
  const literal = { message: firstUrl, stack: `at ${firstUrl}:2:3` };
  assert.equal(JSON.parse(describeApplicationError(literal, worker).identity).error.message, firstUrl);
});

Then("repeated reporting of an error object preserves its first captured origin", function () {
  const received = [];
  const stop = subscribeApplicationErrors(diagnostic => received.push(diagnostic));
  try {
    const error = Object.assign(new Error("Save failed"), { stack: "Error: Save failed\n    at save (worker.js:12:3)" });
    const worker = { source: "worker", scope: "schemas", operation: "save" };
    reportApplicationError(error, worker);
    reportApplicationError(error, { source: "application", scope: "operations > schemas" });
    reportApplicationError(error, { source: "rejection" });
    reportApplicationError(error, { source: "runtime", filename: "app.js", line: 22 });
    assert.equal(received.length, 4);
    assert.ok(received.every(diagnostic => diagnostic.identity === received[0].identity));
    assert.ok(received.every(diagnostic => diagnostic.origin.source === "worker"));
    const sameLocation = Object.assign(new Error("Save failed"), { stack: error.stack });
    reportApplicationError(sameLocation, worker);
    assert.equal(received[4].identity, received[0].identity);
    const otherLocation = Object.assign(new Error("Save failed"), { stack: error.stack });
    reportApplicationError(otherLocation, { ...worker, scope: "workflows" });
    assert.notEqual(received[5].identity, received[0].identity);
    reportApplicationError(null, origin);
    reportApplicationError(function failedOperation() {}, origin);
  } finally { stop(); }
});

Then("diagnostic subscriptions isolate failures recursion and listener changes", function () {
  const unsubscribes = [];
  let reads = 0;
  const value = { get message() { reads += 1; return "Failure"; } };
  reportApplicationError(value, origin);
  assert.equal(reads, 0);
  const received = [];
  try {
    unsubscribes.push(subscribeApplicationErrors(() => { throw new Error("Subscriber failed"); }));
    unsubscribes.push(subscribeApplicationErrors(() => { reportApplicationError("Recursive report", origin); }));
    let added = false;
    unsubscribes.push(subscribeApplicationErrors(diagnostic => {
      received.push(diagnostic);
      if (!added) {
        added = true;
        unsubscribes.push(subscribeApplicationErrors(other => received.push(other)));
      }
    }));
    assert.doesNotThrow(() => reportApplicationError(value, origin));
    assert.equal(reads, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].error.message, "Failure");
    reportApplicationError("Next failure", origin);
    assert.equal(received.length, 3);
    assert.equal(received[2].error.message, "Next failure");
  } finally {
    for (const unsubscribe of unsubscribes) { unsubscribe(); unsubscribe(); }
  }
  reportApplicationError(value, origin);
  assert.equal(reads, 1);
});
