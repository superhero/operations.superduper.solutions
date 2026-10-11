// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { logger } from "./lib/logger.ts";

function captureLogs(action)
{
  const calls = [];
  const originals = { error: console.error, warn: console.warn, log: console.log };
  try {
    for (const method of Object.keys(originals)) console[method] = (...args) => calls.push({ method, args });
    action();
  } finally {
    Object.assign(console, originals);
  }
  return calls;
}

Then("application error logs put original errors first with their stacks causes and context", function () {
  const cause = new Error("Original cause");
  const error = new Error("Original failure", { cause });
  const stack = error.stack;
  const context = { operation: "save" };
  const calls = captureLogs(() => {
    logger.error(error);
    logger.error("Save failed", context, error);
    for (const level of ["critical", "alert", "emergency"]) logger[level](error);
  });
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.method, "error");
    assert.equal(call.args[0], error);
    assert.equal(call.args[0].stack, stack);
    assert.equal(call.args[0].cause, cause);
    assert.equal(call.args.filter(value => value === error).length, 1);
    assert.ok(call.args.includes("[operations]"));
    assert.ok(call.args.every(value => typeof value !== "symbol"));
  }
  assert.ok(calls[1].args.includes("Save failed"));
  assert.ok(calls[1].args.includes(context));
});

Then("application informational warning and plain error logs keep their console severity", function () {
  const error = new Error("Unavailable setting");
  const calls = captureLogs(() => {
    logger.info("Started");
    logger.warn("Using defaults", error);
    logger.error("Missing configuration");
  });
  assert.deepEqual(calls.map(call => call.method), ["log", "warn", "error"]);
  assert.ok(calls[0].args.includes("Started"));
  assert.ok(calls[1].args.includes("Using defaults"));
  assert.ok(calls[1].args.includes(error));
  assert.ok(calls[2].args.includes("Missing configuration"));
});

Then("application logger scopes and optional metadata remain readable", function () {
  const error = new Error("Storage unavailable");
  const scoped = logger.scope("storage");
  const unscoped = logger.child();
  unscoped.unscope();
  const withoutScope = logger.child({ processors: [{ process: meta => ({ ...meta, scope: undefined }) }] });
  const calls = captureLogs(() => {
    scoped.error("Could not save", error);
    unscoped.error(error);
    withoutScope.error(error);
  });
  assert.ok(calls[0].args.includes("[operations > storage]"));
  assert.ok(calls[0].args.includes("Could not save"));
  assert.deepEqual(calls[1].args, [error]);
  assert.deepEqual(calls[2].args, [error]);
});
