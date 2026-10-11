// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { createIntegerScale } from "./lib/integer-scale.ts";

const lowest = Number.MIN_SAFE_INTEGER;
const highest = Number.MAX_SAFE_INTEGER;

Then("logarithmic integer scales preserve zero negatives and exact safe endpoints", function () {
  const scale = createIntegerScale();
  assert.equal(scale.minimum, lowest);
  assert.equal(scale.maximum, highest);
  assert.equal(scale.empty, false);
  assert.equal(scale.value(0), lowest);
  assert.equal(scale.value(1), highest);
  assert.equal(scale.position(lowest), 0);
  assert.equal(scale.position(highest), 1);
  assert.equal(scale.position(0), 0.5);
  assert.equal(scale.value(0.5), 0);
  assert.ok(scale.value(0.25) < -1);
  assert.ok(scale.value(0.75) > 1);
  const positive = createIntegerScale({ minimum: 0 });
  assert.equal(positive.position(0), 0);
  assert.ok(positive.value(0.5) > 1_000_000);
  assert.ok(positive.value(0.5) < highest / 1_000_000);
  for (const value of [-1, 0, 1, 10, 1000]) {
    assert.equal(scale.value(scale.position(value)), value);
    if (value >= 0) assert.equal(positive.value(positive.position(value)), value);
  }
});

Then("bounded integer scales are symmetric around their midpoint and monotonic", function () {
  const scale = createIntegerScale({ minimum: 0, maximum: 100 });
  assert.equal(scale.value(0.5), 50);
  assert.equal(scale.value(0.25), 9);
  assert.equal(scale.value(0.75), 91);
  // Equal thumb travel must change more values in the middle than at the ends.
  assert.ok(scale.value(0.55) - scale.value(0.45) > scale.value(0.1) - scale.value(0));
  assert.ok(scale.value(0.55) - scale.value(0.45) > scale.value(1) - scale.value(0.9));
  for (const bounds of [{ minimum: 0, maximum: 100 }, { minimum: -100, maximum: 0 },
    { minimum: -100, maximum: 100 }, { minimum: lowest, maximum: highest }, { minimum: -80, maximum: 120 }]) {
    const scale = createIntegerScale(bounds);
    let previous = scale.minimum;
    for (let step = 0; step <= 1000; step++) {
      const position = step / 1000;
      const value = scale.value(position);
      assert.ok(Number.isSafeInteger(value));
      assert.ok(value >= previous && value <= scale.maximum, `${JSON.stringify(bounds)} at ${position}`);
      assert.ok(Math.abs(value + scale.value(1 - position) - (bounds.minimum + bounds.maximum)) <= Math.max(1, Math.abs(value) * 1e-13));
      previous = value;
    }
  }
  const negative = createIntegerScale({ maximum: -10 });
  assert.equal(negative.minimum, lowest);
  assert.equal(negative.value(1), -10);
  assert.ok(negative.value(0.5) < -10);
});

Then("integer scales round bounds inward and handle fixed empty and nonfinite ranges", function () {
  const fractional = createIntegerScale({ minimum: -2.8, maximum: 4.9 });
  assert.equal(fractional.minimum, -2);
  assert.equal(fractional.maximum, 4);
  const fixed = createIntegerScale({ minimum: 4.1, maximum: 5.9 });
  assert.equal(fixed.minimum, 5);
  assert.equal(fixed.maximum, 5);
  assert.equal(fixed.empty, false);
  for (const position of [-Infinity, 0, 0.5, 1, Infinity, NaN]) assert.equal(fixed.value(position), 5);
  assert.equal(fixed.position(100), 0.5);
  for (const bounds of [{ minimum: 1.1, maximum: 1.9 }, { minimum: 10, maximum: 1 }, { minimum: highest + 100 },
    { maximum: lowest - 100 }, { minimum: Infinity }, { maximum: -Infinity }]) {
    const scale = createIntegerScale(bounds);
    assert.equal(scale.empty, true, JSON.stringify(bounds));
    assert.equal(scale.value(0.5), undefined);
    assert.equal(scale.position(0), 0.5);
    assert.ok(Number.isSafeInteger(scale.minimum) && Number.isSafeInteger(scale.maximum));
  }
  const infinite = createIntegerScale({ minimum: -Infinity, maximum: Infinity });
  assert.equal(infinite.empty, false);
  assert.equal(infinite.value(-Infinity), lowest);
  assert.equal(infinite.value(Infinity), highest);
  assert.equal(infinite.value(NaN), 0);
  assert.equal(infinite.position(-Infinity), 0);
  assert.equal(infinite.position(Infinity), 1);
  assert.equal(infinite.position(NaN), 0.5);
  const unspecified = createIntegerScale({ minimum: NaN, maximum: NaN });
  assert.equal(unspecified.minimum, lowest);
  assert.equal(unspecified.maximum, highest);
  const rounded = createIntegerScale({ minimum: -10, maximum: 10 });
  assert.equal(rounded.value(rounded.position(2.4)), 2);
  assert.equal(rounded.value(rounded.position(-0.1)), 0);
});

Then("integer scale conversions round trip within floating point precision", function () {
  const ranges = [{}, { minimum: 0 }, { minimum: -100 }, { minimum: highest - 10 }, { minimum: highest - 1 },
    { minimum: 5, maximum: 10 }, { minimum: -10, maximum: -1 },
    { minimum: lowest, maximum: lowest + 10 }, { minimum: lowest, maximum: lowest + 1 }, { minimum: highest - 10, maximum: highest },
    { minimum: highest - 1, maximum: highest }, { minimum: -highest + 1, maximum: highest - 1 }];
  for (const bounds of ranges) {
    const scale = createIntegerScale(bounds);
    let previousPosition = -1;
    for (let step = 0; step <= 1000; step++) {
      const position = step / 1000;
      const value = scale.value(position);
      const converted = scale.position(value);
      assert.ok(Number.isSafeInteger(value) && value >= scale.minimum && value <= scale.maximum);
      assert.ok(Number.isFinite(converted) && converted >= 0 && converted <= 1);
      assert.ok(converted >= previousPosition);
      const returned = scale.value(converted);
      assert.ok(Math.abs(value - returned) <= Math.max(1, Math.abs(value) * 1e-13), `${JSON.stringify(bounds)}: ${value} became ${returned}`);
      previousPosition = converted;
    }
    assert.equal(scale.value(0), scale.minimum);
    assert.equal(scale.value(1), scale.maximum);
  }
});
