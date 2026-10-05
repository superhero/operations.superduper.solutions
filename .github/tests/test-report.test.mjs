// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import "./support.mjs";

Given("Cucumber results from source, acceptance, and automation suites", function ()
{
  this.testReport = { output: join(this.automation.root, "test-report.html"), inputs: [] };
  for (const suite of ["source", "acceptance", "automation"])
  {
    const file = join(this.automation.root, `${suite}.json`);
    const feature = { id: suite, keyword: "Feature", name: `${suite} suite`, description: "", line: 1,
      uri: `${suite}.feature`, elements: [{ id: `${suite};scenario`, keyword: "Scenario", name: `${suite} scenario`,
        line: 2, type: "scenario", steps: [{ keyword: "Given ", name: `${suite} step`, line: 3,
          result: { status: suite === "acceptance" ? "failed" : "passed", duration: 1000000,
            ...(suite === "acceptance" ? { error_message: "A useful failure reason" } : {}) } }] }] };
    writeFileSync(file, JSON.stringify([feature]));
    this.testReport.inputs.push(file);
  }
  writeFileSync(join(this.automation.root, "coverage-summary.json"), "{}");
  writeFileSync(this.testReport.output, "stale successful report");
});

Given("the acceptance report is {string}", function (problem)
{
  const file = this.testReport.inputs[1];
  if (problem === "missing") unlinkSync(file);
  else writeFileSync(file, { "malformed JSON": "{", empty: "[]", "invalid shape": "[{}]" }[problem]);
});

When("the standalone test report is generated", function ()
{
  const script = fileURLToPath(new URL("../scripts/generate-test-report.mjs", import.meta.url));
  this.result = spawnSync(process.execPath, [script, this.testReport.output, ...this.testReport.inputs],
    { cwd: this.automation.root, env: this.automation.env, encoding: "utf8", timeout: 10000 });
  assert.ifError(this.result.error);
  for (const secret of [this.automation.env.GH_TOKEN, this.automation.env.CLOUDFLARE_API_TOKEN])
    assert.ok(!(this.result.stdout + this.result.stderr).includes(secret), "Report diagnostics exposed a test credential");
});

Then("the report embeds all suite results, feature pages, scripts, styles, and fonts", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const html = readFileSync(this.testReport.output, "utf8");
  const files = JSON.parse(html.match(/<script id="report-files" type="application\/json">([^<]+)<\/script>/)[1]);
  const decode = path => Buffer.from(files[path].data, "base64").toString("utf8");
  const features = Object.keys(files).filter(path => path.startsWith("features/") && path.endsWith(".html"));
  assert.equal(features.length, 3);
  const pages = features.map(decode).join("\n");
  for (const suite of ["source", "acceptance", "automation"])
  {
    assert.ok(decode("index.html").includes(`${suite} suite`));
    assert.ok(pages.includes(`${suite} scenario`));
    assert.ok(pages.includes(`${suite} step`));
  }
  assert.ok(pages.includes("A useful failure reason"));
  for (const path of ["styles.min.css", "scripts/table.js", "scripts/scenarios.js", "scripts/charts.js",
    "assets/js/apex-charts.js", "assets/css/font-awesome.css", "assets/images/logo.png"])
    assert.ok(files[path]?.data, `Missing embedded resource: ${path}`);
  for (const [path, file] of Object.entries(files))
  {
    const references = file.type === "text/css" ? [...decode(path).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map(match => match[2]) :
      file.type === "text/html" ? [...decode(path).matchAll(/<(?:a|script|link|img|source|video|audio)\b[^>]*>/g)]
        .flatMap(([tag]) => [...tag.matchAll(/(?:src|href|poster)="([^"]*)"/g)].map(match => match[1])) : [];
    for (const reference of references)
    {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
      assert.ok(files[posix.normalize(posix.join(posix.dirname(path), reference))], `Unbundled report resource: ${reference}`);
    }
  }
  assert.ok(!/<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=/.test(html), "Standalone shell must not load external assets");
  assert.deepEqual(this.automation.calls(), []);
});

Then("report generation fails with input and output context and removes any stale HTML", function ()
{
  assert.notEqual(this.result.status, 0);
  for (const text of ["Cannot generate test report", this.testReport.output, this.testReport.inputs[1]])
    assert.ok(this.result.stderr.includes(text), this.result.stderr);
  assert.equal(existsSync(this.testReport.output), false);
  assert.deepEqual(this.automation.calls(), []);
});
