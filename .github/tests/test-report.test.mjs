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

const screenshot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6E0AAAAASUVORK5CYII=";

Given("Cucumber results from source, acceptance, browser, and automation suites", function ()
{
  this.testReport = { output: join(this.automation.root, "test-report.html"), inputs: [] };
  this.automation.env.REPORT_RUN_URL = "https://github.com/superhero/operations.superduper.solutions/actions/runs/37898008768";
  this.automation.env.REPORT_COMMIT = "af28ee270f2df1ecf9d50a7584b1de577ef25c8b";
  for (const suite of ["source", "acceptance", "browser", "automation"])
  {
    const file = join(this.automation.root, `cucumber-${suite === "acceptance" ? "test" : suite}.json`);
    const feature = { id: suite, keyword: "Feature", name: `${suite} suite`, description: "", line: 1,
      uri: `${suite}.feature`, elements: [{ id: `${suite};scenario`, keyword: "Scenario", name: `${suite} scenario`,
        line: 2, type: "scenario", steps: [{ keyword: "Given ", name: `${suite} step`, line: 3,
          result: { status: suite === "acceptance" ? "failed" : "passed", duration: 1000000,
            ...(suite === "acceptance" ? { error_message: "A useful failure reason" } : {}) },
          ...(suite === "browser" ? { embeddings: [{ data: screenshot, mime_type: "image/png" }] } : {}) }] }] };
    if (suite === "browser") feature.elements[0].before = [{ result: { status: "passed", duration: 0 },
      embeddings: [{ mime_type: "application/vnd.operations.browser+json",
        data: Buffer.from(JSON.stringify({ name: "chromium", version: "123.0.0.1" })).toString("base64") }] }];
    writeFileSync(file, JSON.stringify([feature]));
    this.testReport.inputs.push(file);
  }
  writeFileSync(join(this.automation.root, "coverage-summary.json"), "{}");
  writeFileSync(this.testReport.output, "stale successful report");
});

Given("browser results were not produced by a failed CI run", function ()
{
  const missing = this.testReport.inputs.splice(2, 1)[0];
  unlinkSync(missing);
  this.automation.env.REPORT_WARNING = "CI failed. Missing suite results: browser <suite> & diagnostics.";
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
  assert.ok(decode("index.html").includes(`<a href="${this.automation.env.REPORT_RUN_URL}" target="_blank" rel="noopener noreferrer">37898008768</a>`),
    "CI Pipeline must link to the run URL using only the run ID as its label");
  const features = Object.keys(files).filter(path => path.startsWith("features/") && path.endsWith(".html"));
  assert.equal(features.length, 4);
  const overview = decode("index.html");
  assert.ok(overview.includes("af28ee2"), "Display the seven-character commit hash");
  assert.ok(!overview.includes(this.automation.env.REPORT_COMMIT), "Do not display the full commit hash");
  assert.ok(overview.includes("chromium 123.0.0.1"), "Use the browser identity captured during the run");
  assert.ok(overview.includes("Not applicable"), "Non-browser suites must not claim to use Chromium");
  for (const path of ["index.html", ...features])
  {
    const page = decode(path);
    assert.ok(!/>\s*Username\s*</.test(page), "Omit the runtime username from report headers");
    const footer = page.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
    if (footer !== undefined)
      assert.equal(footer.replace(/<[^>]*>/g, "").trim(), "", "The footer must be empty");
    assert.ok(page.includes("footer { display: none; }"), "Hide the empty footer wrapper");
    assert.ok(!page.includes("application/vnd.operations.browser+json"), "Do not display metadata-only attachments");
    if (path !== "index.html" && !page.includes("browser scenario"))
      assert.ok(!page.includes("chromium 123.0.0.1"), "Browser metadata must stay scoped to browser features");
  }
  // Preparing reporter input must not rewrite the original Cucumber results.
  const originalBrowser = JSON.parse(readFileSync(this.testReport.inputs[2], "utf8"))[0];
  assert.equal(originalBrowser.elements[0].before[0].embeddings[0].mime_type, "application/vnd.operations.browser+json");
  const pages = features.map(decode).join("\n");
  for (const suite of ["source", "acceptance", "browser", "automation"])
  {
    assert.ok(decode("index.html").includes(`${suite} suite`));
    assert.ok(pages.includes(`${suite} scenario`));
    assert.ok(pages.includes(`${suite} step`));
  }
  assert.ok(pages.includes("A useful failure reason"));
  assert.ok(pages.includes(screenshot), "Browser screenshots must remain embedded in the standalone report");
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

Then("the diagnostic report displays its failure warning as text", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const html = readFileSync(this.testReport.output, "utf8");
  assert.ok(html.includes('id="report-warning" role="status">CI failed. Missing suite results: browser &lt;suite&gt; &amp; diagnostics.</p>'));
  assert.ok(!html.includes("browser <suite>"), "Diagnostic text must not become report markup");
  const files = JSON.parse(html.match(/<script id="report-files" type="application\/json">([^<]+)<\/script>/)[1]);
  assert.equal(Object.keys(files).filter(path => path.startsWith("features/") && path.endsWith(".html")).length, 3);
});

Then("report generation fails with input and output context and removes any stale HTML", function ()
{
  assert.notEqual(this.result.status, 0);
  for (const text of ["Cannot generate test report", this.testReport.output, this.testReport.inputs[1]])
    assert.ok(this.result.stderr.includes(text), this.result.stderr);
  assert.equal(existsSync(this.testReport.output), false);
  assert.deepEqual(this.automation.calls(), []);
});
