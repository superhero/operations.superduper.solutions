// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, When, Then } from "@cucumber/cucumber";
import { parseDocument } from "yaml";

function enabled(step, reused, ready = true)
{
  if (step.if === undefined) return true;
  const expression = step.if.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")
    .replace(/needs\.([\w-]+)/g, 'needs["$1"]');
  const needs = {
    validation: { outputs: { reused: String(reused) } },
    "release-changelog": { outputs: { ready: String(ready) } },
    "prepare-changelog": { outputs: { updated: "false" } }
  };
  const github = { head_ref: "release/1.2.3" };
  return new Function("needs", "github", "startsWith", `return (${expression});`)(
    needs, github, (value, prefix) => value.startsWith(prefix));
}

function suiteSteps(jobs)
{
  return [...jobs["workflow-checks"].steps, ...jobs.application.steps]
    .filter(step => /npm .*run (?:typecheck|test:automation|test:source:coverage|test:coverage|build|test:acceptance|test:browser)\b/.test(step.run ?? ""));
}

Given("the validation workflow for {string}", function (target)
{
  const document = parseDocument(readFileSync(new URL(`../workflows/ci-${target}.yml`, import.meta.url), "utf8"));
  assert.deepEqual(document.errors, []);
  this.validationWorkflow = document.toJS();
  this.validationTarget = target;
});

When("matching validation is {string}", function (state)
{
  this.validationAvailable = state === "available";
});

Then("all validation suites run before a new proof is published", function ()
{
  const { jobs } = this.validationWorkflow;
  const suites = suiteSteps(jobs);
  assert.equal(suites.length, 7, "Automation, typecheck, source coverage, coverage gate, build, acceptance and browser checks are mandatory");
  for (const step of suites) assert.equal(enabled(step, this.validationAvailable), true);
  const steps = jobs.application.steps;
  const proof = steps.findIndex(step => step.run?.includes("validation-artifacts.mjs create"));
  assert.ok(proof > 0);
  for (const check of ["report:tests", "badges:scenarios", "badges:coverage", "test:browser"])
  {
    const index = steps.findIndex(step => step.run?.includes(check));
    assert.ok(index >= 0 && index < proof, `${check} must succeed before a reusable proof is created`);
  }
  assert.equal(enabled(steps[proof], false), true);
  assert.equal(enabled(steps.find(step => step.with?.name === "validation-manifest"), false), true);
});

Then("release artifacts remain bound to the exact tested checkout", function ()
{
  const { jobs } = this.validationWorkflow;
  const expected = this.validationTarget === "main"
    ? "${{ github.event.pull_request.head.sha }}" : "${{ github.sha }}";
  const checkout = jobs.application.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  const proof = jobs.application.steps.find(step => step.run?.includes("validation-artifacts.mjs create"));
  const report = jobs.application.steps.find(step => step.id === "report");
  assert.equal(checkout.with.ref, expected);
  assert.equal(proof.env.TESTED_SHA, expected);
  assert.equal(report.env.REPORT_COMMIT, expected);
  assert.equal(proof.env.PR_HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
  assert.match(proof.run, /"\$GITHUB_RUN_ID" "\$GITHUB_RUN_ATTEMPT"/);
  for (const [name, path] of Object.entries({ bundle: "tmp/validation/bundle", coverage: "tmp/validation/coverage", "test-report": "tmp/validation/test-report/test-report.html" }))
  {
    const upload = jobs.application.steps.find(step => step.with?.name === name);
    assert.equal(upload.with.path, path);
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.equal(upload.with["retention-days"], 7);
    assert.match(proof.run, new RegExp(path.replaceAll(".", "\\.")));
  }
});

Then("validation suites and new proof creation are skipped", function ()
{
  const { jobs } = this.validationWorkflow;
  for (const step of suiteSteps(jobs)) assert.equal(enabled(step, true), false);
  for (const step of jobs.application.steps.filter(step => step.run?.includes("validation-artifacts.mjs") || step.with?.name === "validation-manifest"))
    assert.equal(enabled(step, true), false, "A reused run cannot become a new source of validation evidence");
  const report = jobs.application.steps.find(step => step.id === "report");
  assert.equal(enabled(report, true), false, "A reused report must not be relabelled as newly executed");
});

Then("the verified artifacts and original report provenance are preserved", function ()
{
  const { jobs } = this.validationWorkflow;
  const find = jobs.validation.steps.find(step => step.id === "find");
  assert.match(find.run, /find-validation\.mjs .*tmp\/reused-validation$/);
  const retain = jobs.validation.steps.find(step => step.with?.name === "reused-validation");
  assert.equal(retain.if, "steps.find.outputs.reused == 'true'");
  assert.equal(retain.with.path, "tmp/reused-validation");
  assert.equal(retain.with.overwrite, true, "Reruns replace the handoff artifact after verifying it again");
  const restore = jobs.application.steps.find(step => step.run?.includes("--name reused-validation"));
  assert.equal(enabled(restore, true), true);
  assert.match(restore.run, /gh run download "\$GITHUB_RUN_ID" --repo "\$GITHUB_REPOSITORY" --name reused-validation --dir tmp\/validation/);
  assert.match(restore.run, /original commit and run URL/);
  assert.equal(restore.env.SOURCE_RUN_ID, "${{ needs.validation.outputs.source_run_id }}");
  for (const name of ["bundle", "coverage", "test-report"])
    assert.equal(enabled(jobs.application.steps.find(step => step.with?.name === name), true), true);
});

Then("reuse has read-only access and publication requires successful validation", function ()
{
  const { jobs } = this.validationWorkflow;
  assert.deepEqual(jobs.validation.permissions, { actions: "read", contents: "read" });
  assert.deepEqual(jobs.application.permissions, { actions: "read", contents: "read" });
  for (const name of ["workflow-checks", "application"])
    assert.ok([jobs[name].needs].flat().includes("validation"), `${name} cannot run after failed evidence verification`);
  assert.ok([jobs.application.needs].flat().includes("workflow-checks"));
  assert.ok([jobs["auto-merge"].needs].flat().includes("application"));
  for (const job of [jobs.validation, jobs["workflow-checks"], jobs.application, jobs["auto-merge"], jobs.preview])
  {
    assert.equal(job["continue-on-error"], undefined);
    assert.doesNotMatch(job.if ?? "", /\b(?:always|failure|cancelled)\s*\(/);
  }
  for (const step of [...suiteSteps(jobs), ...jobs.application.steps.filter(step => step.run?.includes("validation-artifacts.mjs"))])
  {
    assert.equal(step["continue-on-error"], undefined);
    assert.doesNotMatch(step.if ?? "", /\b(?:always|failure|cancelled)\s*\(/);
  }
});

Then("the release application job waits for the changelog documentation PR", function ()
{
  const { jobs } = this.validationWorkflow;
  assert.ok(jobs.application.needs.includes("release-changelog"));
  assert.equal(enabled(jobs.application, false, false), false);
  assert.equal(enabled(jobs.application, true, false), false);
  assert.equal(enabled(jobs.application, true, true), true);
  const prepare = jobs["release-changelog"];
  assert.ok(prepare.needs.includes("workflow-checks"));
  assert.ok(prepare.needs.includes("validate-pr"));
  assert.equal(prepare.outputs.ready, "${{ steps.prepare.outputs.ready }}");
  assert.match(prepare.steps.find(step => step.id === "prepare").run, /create-release-changelog-pr\.sh/);
});
