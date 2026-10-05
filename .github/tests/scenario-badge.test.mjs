// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import "./support.mjs";

function reports(world)
{
  const scenario = id => ({ id, type: "scenario", keyword: "Scenario Outline", name: "An example",
    steps: [{ keyword: "Given ", name: "a passing step", result: { status: "passed" } }] });
  world.scenarioBadge = {
    output: join(world.automation.root, "badges"),
    inputs: [join(world.automation.root, "source.json"), join(world.automation.root, "automation.json")],
    data: [[{ name: "Source", elements: [
      { ...scenario("background"), type: "background" }, scenario("outline"), scenario("outline")]
    }], [{ name: "Automation", elements: [{ ...scenario("automation"), steps: [
      { keyword: "Before", hidden: true, result: { status: "passed" } },
      ...scenario("automation").steps,
      { keyword: "After", hidden: true, result: { status: "passed" } }
    ] }] }]]
  };
  save(world.scenarioBadge);
}

function save(state)
{
  state.inputs.forEach((file, index) => writeFileSync(file, JSON.stringify(state.data[index])));
}

function generate(world, check = false)
{
  return world.automation.execute("generate-scenario-badge.sh",
    [world.scenarioBadge.output, ...world.scenarioBadge.inputs, ...(check ? ["--check"] : [])], [], { success: null });
}

function snapshot(directory)
{
  return Object.fromEntries(readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name), "utf8")]));
}

function badge(world, message, color)
{
  assert.equal(world.result.status, 0, world.result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(world.scenarioBadge.output, "test-scenarios.json"), "utf8")),
    { schemaVersion: 1, label: "Test Scenarios", message, color });
  const svg = readFileSync(join(world.scenarioBadge.output, "test-scenarios.svg"), "utf8");
  for (const text of [`aria-label="Test Scenarios: ${message}"`, `<title>Test Scenarios: ${message}</title>`, `>${message}</text>`,
    `fill="${{ brightgreen: "#4c1", orange: "#fe7d37", red: "#e05d44" }[color]}"`])
    assert.ok(svg.includes(text), svg);
  assert.deepEqual(world.automation.calls(), []);
}

Given("passing scenario reports with repeated outline IDs and a background", function ()
{
  reports(this);
});

When("local scenario badges are generated", function ()
{
  this.result = generate(this);
  assert.equal(this.result.status, 0, this.result.stderr);
  this.scenarioBadgesBefore = snapshot(this.scenarioBadge.output);
});

Then("the scenario JSON and SVG show {string} in {string}", function (message, color)
{
  badge(this, message, color);
});

When("local scenario badges are checked", function ()
{
  this.result = generate(this, true);
});

Then("the local scenario badge check succeeds", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
});

Then("a recorded hook status produces these scenario badges:", function (table)
{
  for (const { status, message, color } of table.hashes())
  {
    this.scenarioBadge.data[1][0].elements[0].steps.at(-1).result.status = status;
    save(this.scenarioBadge);
    this.result = generate(this);
    badge(this, message, color);
  }
});

When("only the scenario SVG is changed", function ()
{
  writeFileSync(join(this.scenarioBadge.output, "test-scenarios.svg"), "stale SVG");
  this.scenarioBadgesBefore = snapshot(this.scenarioBadge.output);
});

When("a scenario result changes", function ()
{
  this.scenarioBadge.data[0][0].elements[1].steps[0].result.status = "failed";
  save(this.scenarioBadge);
});

Then("the scenario check reports stale {string} without changing files", function (name)
{
  assert.notEqual(this.result.status, 0);
  for (const text of ["missing or stale", name, ...this.scenarioBadge.inputs,
    this.scenarioBadge.output, "npm run badges:scenarios"])
    assert.ok(this.result.stderr.includes(text), this.result.stderr);
  assert.deepEqual(snapshot(this.scenarioBadge.output), this.scenarioBadgesBefore);
});

Then("scenario badge generation rejects these report problems without writing files:", function (table)
{
  for (const { problem } of table.hashes())
  {
    reports(this);
    const state = this.scenarioBadge;
    const scenario = state.data[1][0].elements[0];
    if (problem === "missing file") unlinkSync(state.inputs[1]);
    else if (problem === "malformed JSON") writeFileSync(state.inputs[1], "{");
    else
    {
      if (problem === "empty report") state.data[1] = [];
      else if (problem === "no scenarios") scenario.type = "background";
      else if (problem === "missing scenario ID") delete scenario.id;
      else if (problem === "empty steps") scenario.steps = [];
      else if (problem === "missing result status") delete scenario.steps[0].result.status;
      else if (problem === "unknown result status") scenario.steps[0].result.status = "unknown";
      else assert.fail(`Unknown report problem: ${problem}`);
      save(state);
    }
    const result = generate(this);
    assert.notEqual(result.status, 0, problem);
    for (const text of ["Invalid Cucumber report", state.inputs[1], state.output, "npm run badges:scenarios"])
      assert.ok(result.stderr.includes(text), result.stderr);
    assert.equal(existsSync(state.output), false, problem);
  }
  assert.deepEqual(this.automation.calls(), []);
});
