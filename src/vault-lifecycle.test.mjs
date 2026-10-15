// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { createVaultLifecycle } from "./lib/secrets/lifecycle.ts";
import { VaultError } from "./lib/secrets/types.ts";

const prefs = (idleLockMinutes = 10, idleLockEnabled = true) => ({ idleLockEnabled, idleLockMinutes });
function fixture(preferences) {
  let time = 1_000, locks = 0;
  const deadlines = [];
  const controller = createVaultLifecycle({ now: () => time, onLock: () => locks++,
    onDeadline: deadline => deadlines.push(deadline), ...(preferences ? { preferences } : {}) });
  return { controller, deadlines, set: value => { time = value; }, locks: () => locks };
}

Then("vault inactivity starts disabled and only explicit activation starts a session", () => {
  const f = fixture();
  assert.equal(f.controller.deadline(), null);
  assert.equal(f.controller.check(), false);
  f.controller.activity(true, true);
  f.controller.configure(prefs(10, false));
  assert.deepEqual(f.deadlines, []);
  f.controller.activate();
  assert.equal(f.controller.check(), true);
  f.set(100_000_000);
  assert.equal(f.controller.check(), true);
  assert.equal(f.controller.deadline(), null);
  assert.equal(f.locks(), 0);
  assert.deepEqual(f.deadlines, [null]);
});

Then("vault inactivity ignores synthetic and background activity", () => {
  const f = fixture(prefs(1));
  f.controller.activate();
  assert.equal(f.controller.deadline(), 61_000);
  f.set(20_000); f.controller.activity(false, true);
  f.set(30_000); f.controller.activity(true, false);
  f.set(40_000); f.controller.activity(false, false);
  assert.equal(f.controller.deadline(), 61_000);
  f.set(50_000); f.controller.activity(true, true);
  assert.equal(f.controller.deadline(), 110_000);
  assert.deepEqual(f.deadlines, [61_000, 110_000]);
  f.set(109_999); assert.equal(f.controller.check(), true);
  f.set(110_000); assert.equal(f.controller.check(), false);
  assert.equal(f.locks(), 1);
});

Then("an expired vault locks before activity or preference changes can extend it", () => {
  for (const action of [c => c.activity(true, true), c => c.activity(false, false),
    c => c.configure(prefs(1440)), c => c.configure(prefs(10, false)), c => c.check()]) {
    const f = fixture(prefs(1));
    f.controller.activate();
    f.set(61_000); action(f.controller);
    assert.equal(f.controller.deadline(), null);
    assert.equal(f.locks(), 1);
    f.controller.activity(true, true); f.controller.check();
    assert.equal(f.locks(), 1);
    assert.equal(f.controller.check(), false);
    assert.deepEqual(f.deadlines, [61_000, null]);
  }
});

Then("changing vault inactivity preferences uses the previous activity time", () => {
  const f = fixture();
  f.controller.activate();
  f.set(20_000); f.controller.activity(true, true);
  f.set(40_000); f.controller.configure(prefs(2));
  assert.equal(f.controller.deadline(), 140_000);
  f.set(60_000); f.controller.configure(prefs(1));
  assert.equal(f.controller.deadline(), 80_000);
  f.set(70_000); f.controller.configure(prefs(1, false));
  assert.equal(f.controller.deadline(), null);
  f.set(81_000); f.controller.configure(prefs(1));
  assert.equal(f.locks(), 1, "reenabling does not invent new activity");
  assert.equal(f.controller.deadline(), null);
  const shorter = fixture(prefs(10));
  shorter.controller.activate(); shorter.set(70_000); shorter.controller.configure(prefs(1));
  assert.equal(shorter.locks(), 1, "shorter preference can already be expired");
});

Then("vault inactivity accepts only whole minutes from one through fourteen forty", () => {
  const invalid = error => error instanceof VaultError && error.code === "INVALID" && !Object.hasOwn(error, "cause");
  for (const value of [0, -1, 1441, 1.5, NaN, Infinity, "10", undefined]) {
    assert.throws(() => fixture({ idleLockEnabled: true, idleLockMinutes: value }), invalid);
    const f = fixture(prefs(1)); f.controller.activate();
    assert.throws(() => f.controller.configure({ idleLockEnabled: false, idleLockMinutes: value }), invalid);
    assert.equal(f.controller.deadline(), 61_000);
  }
  for (const value of [null, {}, { idleLockEnabled: "false", idleLockMinutes: 10 }]) {
    const f = fixture(); assert.throws(() => f.controller.configure(value), invalid);
  }
  for (const minutes of [1, 1440]) {
    const input = prefs(minutes), f = fixture(input);
    input.idleLockMinutes = 0;
    f.controller.activate(); assert.equal(f.controller.deadline(), 1000 + minutes * 60_000);
  }
});

Then("vault inactivity locks on a backward or invalid clock and remains inactive until unlock", () => {
  for (const value of [999, NaN, Infinity]) {
    const f = fixture(prefs(1)); f.controller.activate(); f.set(value);
    assert.equal(f.controller.check(), false);
    assert.equal(f.locks(), 1);
    f.set(2000); f.controller.activity(true, true); f.controller.configure(prefs(2));
    assert.equal(f.controller.deadline(), null);
    f.controller.activate(); assert.equal(f.controller.deadline(), 122_000);
  }
  const f = fixture(); f.controller.activate(); f.set(999); f.controller.check();
  assert.equal(f.locks(), 1, "a backward clock invalidates even an idle-disabled session");
  const future = fixture(prefs(1)); future.set(Number.MAX_SAFE_INTEGER); future.controller.activate();
  assert.equal(future.locks(), 1);
  assert.equal(future.controller.deadline(), null);
  const invalid = fixture(); invalid.controller.activate(); invalid.set(NaN);
  assert.throws(() => invalid.controller.activate(), error => error.code === "INVALID");
  assert.equal(invalid.locks(), 1);
  assert.equal(invalid.controller.check(), false);
  const unavailable = fixture(); unavailable.set(NaN);
  assert.throws(() => unavailable.controller.activate(), error => error.code === "INVALID");
  assert.equal(unavailable.locks(), 0, "an invalid clock cannot create a new session");
  assert.equal(unavailable.controller.check(), false);
});

Then("vault inactivity deactivation is idempotent and explicit unlock starts a new deadline", () => {
  const f = fixture(prefs(1));
  f.controller.activate(); f.controller.deactivate(); f.controller.deactivate();
  assert.deepEqual(f.deadlines, [61_000, null]);
  assert.equal(f.locks(), 0);
  f.set(100_000); f.controller.activity(true, true);
  assert.equal(f.controller.check(), false);
  f.controller.activate(); assert.equal(f.controller.deadline(), 160_000);
  f.set(110_000); f.controller.activate(); assert.equal(f.controller.deadline(), 170_000);
  let locked = false, time = 0;
  const callbacks = createVaultLifecycle({ preferences: prefs(1), now: () => time,
    onLock: () => { locked = true; }, onDeadline: value => { if (value === null) throw new Error("worker stopped"); } });
  callbacks.activate(); time = 60_000;
  assert.throws(() => callbacks.check(), /worker stopped/);
  assert.equal(locked, true, "failed deadline notification cannot skip lock cleanup");
  assert.equal(callbacks.deadline(), null);
});
