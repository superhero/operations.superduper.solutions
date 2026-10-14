// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { acceptance, source } from "../../cucumber.config.mjs";
import "./support.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
const manifest = () => JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
const names = ["An independently reported passing source behavior", "The observed source behavior"];

Then("every source feature and its steps belong to exactly one explicit reporting profile", function ()
{
  const files = readdirSync(join(repository, "src"), { recursive: true }).map(path => `src/${path}`);
  const features = files.filter(path => path.endsWith(".feature")).sort();
  const modules = files.filter(path => path.endsWith(".test.mjs")).sort();
  assert.ok(features.length > 0);
  const registered = { paths: [], import: [] };
  for (const [name, profile] of Object.entries({ source, acceptance }))
  {
    for (const kind of ["paths", "import"])
    {
      assert.ok(Array.isArray(profile[kind]), `${name} must explicitly register ${kind}`);
      for (const path of profile[kind])
        assert.ok(!/[*?{}[\]]/.test(path), `${name} uses an implicit registration: ${path}`);
      registered[kind].push(...profile[kind]);
    }
    assert.deepEqual(profile.import.toSorted(), profile.paths.map(path => path.replace(/\.feature$/, ".test.mjs")).sort(),
      `${name} must load the step module paired with every feature`);
  }
  assert.deepEqual(registered.paths.sort(), features, "Every feature must appear exactly once across the reporting profiles");
  assert.deepEqual(registered.import.sort(), modules, "Every step module must appear exactly once across the reporting profiles");
});

Then("the source test command runs Cucumber without a separate Node test runner", function ()
{
  const { scripts: commands } = manifest();
  assert.match(commands["test:source"], /^cucumber-js\b.*--profile source$/);
  assert.doesNotMatch(commands["test:source"], /&&|\|\||;/);
  assert.equal(Object.hasOwn(commands, "test:unit"), false);
  assert.doesNotMatch(Object.values(commands).join("\n"), /\bnode\s+--test\b|\btest:unit\b/);
});

Given("two named source scenarios with a second scenario that has {string}", function (outcome)
{
  assert.ok(["passing behavior", "assertion failure", "After-hook failure"].includes(outcome));
  const root = this.automation.root;
  this.sourceReporting = { outcome, root, json: join(root, "cucumber-source.json"),
    html: join(root, "test-report.html"), badges: join(root, "badges") };
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module",
    scripts: { "test:source": manifest().scripts["test:source"] } }));
  writeFileSync(join(root, "cucumber.config.mjs"), `export default {};\nexport const source = ${JSON.stringify({ ...source,
    import: ["source-fixture.steps.mjs"], paths: ["source-fixture.feature"],
    format: source.format.map(format => format.startsWith("json:") ? "json:cucumber-source.json" : format)
  })};\n`);
  writeFileSync(join(root, "source-fixture.feature"), `Feature: Source reporting fixture
  Scenario: ${names[0]}
    Then the independent source behavior succeeds

  @observed-source
  Scenario: ${names[1]}
    Then the observed source behavior is checked
`);
  writeFileSync(join(root, "source-fixture.steps.mjs"), `import assert from "node:assert/strict";
import { After, Then } from "@cucumber/cucumber";
const outcome = ${JSON.stringify(outcome)};
Then("the independent source behavior succeeds", () => assert.equal(2 + 2, 4));
Then("the observed source behavior is checked", () => {
  assert.notEqual(outcome, "assertion failure", "Source assertion failed deliberately");
});
After({ tags: "@observed-source" }, () => {
  assert.notEqual(outcome, "After-hook failure", "Source cleanup failed deliberately");
});
`);
});

When("the repository source test command runs against those scenarios", function ()
{
  this.sourceReporting.result = spawnSync(process.execPath, ["--run", "test:source"], {
    cwd: this.sourceReporting.root, encoding: "utf8", timeout: 10000,
    env: { ...this.automation.env, PATH: `${dirname(process.execPath)}${delimiter}${this.automation.env.PATH}` }
  });
  assert.ifError(this.sourceReporting.result.error);
});

Then("its exit status and Cucumber JSON reflect {string} for the second scenario", function (outcome)
{
  const { result, json } = this.sourceReporting;
  const passing = outcome === "passing behavior";
  assert.equal(result.status === 0, passing, result.stdout + result.stderr);
  const features = JSON.parse(readFileSync(json, "utf8"));
  assert.equal(features.length, 1);
  const scenarios = features[0].elements;
  assert.deepEqual(scenarios.map(scenario => scenario.name), names);
  assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, 2);
  assert.ok(scenarios[0].steps.every(step => step.result.status === "passed"));
  const failed = scenarios[1].steps.filter(step => step.result.status === "failed");
  assert.equal(failed.length, passing ? 0 : 1);
  if (!passing)
  {
    assert.equal(Boolean(failed[0].hidden), outcome === "After-hook failure");
    assert.match(failed[0].result.error_message, outcome === "After-hook failure"
      ? /Source cleanup failed deliberately/ : /Source assertion failed deliberately/);
  }
});

Then("the generated HTML and scenario badge retain both individual results", function ()
{
  const state = this.sourceReporting;
  const before = readFileSync(state.json, "utf8");
  const result = spawnSync(process.execPath,
    [join(scripts, "generate-test-report.mjs"), state.html, state.json],
    { cwd: state.root, env: this.automation.env, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const shell = readFileSync(state.html, "utf8");
  const files = JSON.parse(shell.match(/<script id="report-files" type="application\/json">([^<]+)<\/script>/)[1]);
  const pages = Object.keys(files).filter(path => path.startsWith("features/") && path.endsWith(".html"));
  assert.equal(pages.length, 1);
  const page = Buffer.from(files[pages[0]].data, "base64").toString("utf8");
  const cards = page.split(/<div\s+class="[^"]*\bscenario-card\b[^"]*"\s+/).slice(1);
  assert.equal(cards.length, 2, "Each source scenario must have its own report card");
  const passing = state.outcome === "passing behavior";
  for (const [index, card] of cards.entries())
  {
    assert.ok(card.includes(names[index]), `Missing source scenario: ${names[index]}`);
    assert.equal(card.match(/^data-status="([^"]+)"/)[1], index === 0 || passing ? "passed" : "failed");
  }
  if (!passing) assert.ok(page.includes(state.outcome === "After-hook failure"
    ? "Source cleanup failed deliberately" : "Source assertion failed deliberately"));
  this.automation.execute("generate-scenario-badge.sh", [state.badges, state.json]);
  assert.deepEqual(JSON.parse(readFileSync(join(state.badges, "test-scenarios.json"), "utf8")), {
    schemaVersion: 1, label: "Test Scenarios", message: passing ? "2 passed" : "1/2 passed", color: passing ? "brightgreen" : "red"
  });
  assert.equal(readFileSync(state.json, "utf8"), before, "Publishing results must not rewrite their source JSON");
  assert.deepEqual(this.automation.calls(), []);
});
