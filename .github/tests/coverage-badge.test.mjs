// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import "./support.mjs";

function summary(world, percentage)
{
  world.coverageBadge = {
    summary: join(world.automation.root, "coverage-summary.json"),
    output: join(world.automation.root, "badges")
  };
  writeFileSync(world.coverageBadge.summary, JSON.stringify({ total: { statements: { pct: percentage } } }));
}

function generate(world, check = false)
{
  return world.automation.execute("generate-coverage-badge.sh",
    [world.coverageBadge.summary, world.coverageBadge.output, ...(check ? ["--check"] : [])], [], { success: null });
}

function snapshot(directory)
{
  return Object.fromEntries(readdirSync(directory).sort().map(name =>
    [name, readFileSync(join(directory, name), "utf8")]));
}

function failedCheck(world)
{
  assert.notEqual(world.result.status, 0);
  for (const text of ["missing or stale", world.coverageBadge.summary, world.coverageBadge.output, "npm run badges:coverage"])
    assert.ok(world.result.stderr.includes(text), world.result.stderr);
  assert.deepEqual(world.automation.calls(), []);
}

Given("a coverage summary measuring {float} percent", function (percentage)
{
  summary(this, percentage);
});

When("local coverage badges are generated", function ()
{
  this.result = generate(this);
  assert.equal(this.result.status, 0, this.result.stderr);
});

Then("the coverage JSON and SVG show {string} in {string}", function (message, color)
{
  assert.deepEqual(JSON.parse(readFileSync(join(this.coverageBadge.output, "test-coverage.json"), "utf8")),
    { schemaVersion: 1, label: "Test Coverage", message, color });
  const svg = readFileSync(join(this.coverageBadge.output, "test-coverage.svg"), "utf8");
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  for (const text of [`aria-label="Test Coverage: ${message}"`, `<title>Test Coverage: ${message}</title>`,
    `>${message}</text>`, `fill="${color === "brightgreen" ? "#4c1" : "#fe7d37"}"`])
    assert.ok(svg.includes(text), svg);
  assert.deepEqual(readdirSync(this.coverageBadge.output).sort(), ["test-coverage.json", "test-coverage.svg"]);
  assert.deepEqual(this.automation.calls(), []);
});

Given("generated local coverage badges", function ()
{
  summary(this, 100);
  const result = generate(this);
  assert.equal(result.status, 0, result.stderr);
  this.coverageBadgesBefore = snapshot(this.coverageBadge.output);
});

When("local coverage badges are checked", function ()
{
  this.result = generate(this, true);
});

Then("the local coverage badge check succeeds", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.deepEqual(this.automation.calls(), []);
});

When("the measured coverage changes to {float} percent", function (percentage)
{
  writeFileSync(this.coverageBadge.summary, JSON.stringify({ total: { statements: { pct: percentage } } }));
});

When("only the coverage SVG is changed", function ()
{
  writeFileSync(join(this.coverageBadge.output, "test-coverage.svg"), "stale SVG");
  this.coverageBadgesBefore = snapshot(this.coverageBadge.output);
});

Then("the coverage check reports stale badges without changing files", function ()
{
  failedCheck(this);
  assert.deepEqual(snapshot(this.coverageBadge.output), this.coverageBadgesBefore);
});

Then("the coverage check reports missing badges without creating files", function ()
{
  failedCheck(this);
  assert.equal(existsSync(this.coverageBadge.output), false);
});

Then("coverage badge generation rejects these summary problems without writing files:", function (table)
{
  const invalid = {
    "malformed JSON": "{", "missing percentage": {}, "string percentage": "100",
    "negative value": -1, "value above 100": 101
  };
  for (const { problem } of table.hashes())
  {
    assert.ok(Object.hasOwn(invalid, problem));
    summary(this, invalid[problem]);
    if (problem === "malformed JSON") writeFileSync(this.coverageBadge.summary, "{");
    if (problem === "missing percentage") writeFileSync(this.coverageBadge.summary, "{}");
    const result = generate(this);
    assert.notEqual(result.status, 0, problem);
    for (const text of ["numeric total.statements.pct between 0 and 100", this.coverageBadge.summary, this.coverageBadge.output])
      assert.ok(result.stderr.includes(text), result.stderr);
    assert.equal(existsSync(this.coverageBadge.output), false, problem);
  }
  assert.deepEqual(this.automation.calls(), []);
});
