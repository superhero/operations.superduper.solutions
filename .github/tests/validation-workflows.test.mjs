// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, When, Then } from "@cucumber/cucumber";
import { parseDocument } from "yaml";

const requiredSuites = [
  "test:automation", "typecheck", "test:source:coverage", "test:coverage",
  "build", "test:acceptance", "test:browser"
];
const reportChecks = ["report:tests", "badges:scenarios", "badges:coverage"];
const validationArtifacts = ["bundle", "coverage", "test-report"];

function enabled(step, reused, ready = true, status = "success", outcomes = {})
{
  const condition = step.if ?? "true";
  // GitHub applies success() implicitly unless the condition uses a status function.
  if (status !== "success" && !/\b(?:success|always|failure|cancelled)\s*\(/.test(condition)) return false;
  const expression = condition.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")
    .replace(/\b(needs|steps)\.([\w-]+)/g, '$1["$2"]');
  const needs = {
    validation: { outputs: { reused: String(reused) } },
    "release-changelog": { outputs: { ready: String(ready) } },
    "prepare-changelog": { outputs: { updated: "false" } }
  };
  const github = { head_ref: "release/1.2.3" };
  const steps = Object.fromEntries(["automation", "source", "browser", "failure-report"]
    .map(id => [id, { outcome: outcomes[id] ?? status }]));
  return new Function("needs", "github", "steps", "startsWith", "success", "always", "failure", "cancelled", `return (${expression});`)(
    needs, github, steps, (value, prefix) => value.startsWith(prefix),
    () => status === "success", () => true, () => status === "failure", () => status === "cancelled");
}

function npmScripts(step)
{
  return [...(step.run ?? "").matchAll(/(?:^|[;&|])[ \t]*npm(?:[ \t]+--[^\s]+)*[ \t]+run[ \t]+([^\s;&|]+)/gm)]
    .map(([, command]) => command);
}

function npmCommands(jobs)
{
  return ["workflow-checks", "application"].flatMap(job => jobs[job].steps.flatMap(step =>
    npmScripts(step).map(command => ({ job, step, command }))));
}

function suiteSteps(jobs)
{
  return npmCommands(jobs).filter(({ command }) => requiredSuites.includes(command)).map(({ step }) => step);
}

function uniqueStep(steps, predicate, description)
{
  const matching = steps.filter(predicate);
  assert.equal(matching.length, 1, `${description} must have exactly one producer`);
  return matching[0];
}

function validationProof(jobs)
{
  const steps = Object.values(jobs).flatMap(job => job.steps ?? []);
  const create = uniqueStep(steps, step => /validation-artifacts\.mjs\s+create\b/.test(step.run ?? ""), "Validation proof");
  assert.equal([...create.run.matchAll(/validation-artifacts\.mjs\s+create\b/g)].length, 1);
  const upload = uniqueStep(steps, step => step.with?.name === "validation-manifest", "Validation proof upload");
  assert.ok(jobs.application.steps.includes(create));
  assert.ok(jobs.application.steps.includes(upload));
  return { create, upload };
}

function requiresSuccess(step)
{
  assert.equal(step["continue-on-error"], undefined, `${step.name} must propagate failure`);
  assert.doesNotMatch(step.if ?? "", /\b(?:always|failure|cancelled)\s*\(/, `${step.name} must retain its success gate`);
  for (const status of ["failure", "cancelled"])
    for (const reused of [false, true])
      assert.equal(enabled(step, reused, true, status), false, `${step.name} cannot run after ${status}`);
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
  const suites = npmCommands(jobs).filter(({ command }) => requiredSuites.includes(command));
  assert.deepEqual(suites.map(({ command }) => command).sort(), [...requiredSuites].sort(), "Every required suite must run exactly once");
  const steps = jobs.application.steps;
  const { create } = validationProof(jobs);
  const proof = steps.indexOf(create);
  for (const { job, step, command } of suites)
  {
    assert.equal(job, command === "test:automation" ? "workflow-checks" : "application");
    assert.equal(enabled(step, this.validationAvailable), true, `${command} must run on a cache miss`);
    if (job === "application") assert.ok(steps.indexOf(step) < proof, `${command} must finish before proof creation`);
  }
  for (const command of reportChecks)
  {
    const step = uniqueStep(steps, candidate => npmScripts(candidate).includes(command), command);
    assert.ok(steps.indexOf(step) < proof, `${command} must succeed before a reusable proof is created`);
    assert.equal(enabled(step, false), true);
  }
});

Then("exactly one fresh proof is published after all validation artifacts", function ()
{
  const { jobs } = this.validationWorkflow;
  const steps = jobs.application.steps;
  const { create, upload } = validationProof(jobs);
  for (const step of [create, upload])
  {
    assert.equal(enabled(step, false), true);
    assert.equal(enabled(step, true), false, "Only fresh validation can publish new proof");
    requiresSuccess(step);
  }
  assert.match(upload.uses, /^actions\/upload-artifact@/);
  assert.equal(upload.with.path, "tmp/validation/validation-manifest.json");
  assert.equal(upload.with["if-no-files-found"], "error");
  for (const name of validationArtifacts)
  {
    const artifact = uniqueStep(steps, step => step.with?.name === name, `${name} upload`);
    assert.ok(steps.indexOf(create) < steps.indexOf(artifact), `${name} must contain the newly validated files`);
    assert.ok(steps.indexOf(artifact) < steps.indexOf(upload), `${name} must upload successfully before proof publication`);
    requiresSuccess(artifact);
  }
});

Then("release artifacts remain bound to the exact tested checkout", function ()
{
  const { jobs } = this.validationWorkflow;
  const expected = this.validationTarget === "main"
    ? "${{ github.event.pull_request.head.sha }}" : "${{ github.sha }}";
  const checkout = jobs.application.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  const automationCheckout = uniqueStep(jobs["workflow-checks"].steps,
    step => step.uses?.startsWith("actions/checkout@"), "Automation checkout");
  const proof = jobs.application.steps.find(step => step.run?.includes("validation-artifacts.mjs create"));
  const report = jobs.application.steps.find(step => step.id === "report");
  assert.equal(checkout.with.ref, expected);
  assert.equal(automationCheckout.with?.ref ?? "${{ github.sha }}", expected, "Automation and application must test the same revision");
  assert.equal(enabled(automationCheckout, false), true);
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
  for (const required of ["workflow-checks", "validate-pr", "validation"])
    assert.ok([jobs.application.needs].flat().includes(required), `Proof production must wait for ${required}`);
  assert.ok([jobs["auto-merge"].needs].flat().includes("application"));
  for (const job of [jobs.validation, jobs["workflow-checks"], jobs["validate-pr"], jobs.application, jobs["auto-merge"], jobs.preview])
  {
    assert.equal(job["continue-on-error"], undefined);
    assert.doesNotMatch(job.if ?? "", /\b(?:always|failure|cancelled)\s*\(/);
  }
  const { create, upload } = validationProof(jobs);
  const reports = npmCommands(jobs).filter(({ command }) => reportChecks.includes(command)).map(({ step }) => step);
  for (const step of [...suiteSteps(jobs), ...reports, create, upload]) requiresSuccess(step);
});

Then("failure diagnostics cannot substitute for successful validation proof", function ()
{
  const { jobs } = this.validationWorkflow;
  const steps = jobs.application.steps;
  const report = uniqueStep(steps, step => step.id === "failure-report", "Failure report");
  const upload = uniqueStep(steps, step => step.with?.name === "validation-diagnostics", "Failure diagnostics upload");
  assert.match(report.run, /does not certify a successful build/);
  assert.doesNotMatch(report.run, /validation-artifacts\.mjs|tmp\/validation\//);
  assert.match(upload.uses, /^actions\/upload-artifact@/);
  assert.doesNotMatch(upload.with.path, /validation-manifest|tmp\/validation\//);
  for (const step of [report, upload])
  {
    assert.equal(enabled(step, false), false, `${step.name} is reserved for failed validation`);
    assert.equal(enabled(step, false, true, "failure", { "failure-report": "success" }), true);
  }
  const proof = validationProof(jobs);
  for (const step of [proof.create, proof.upload, ...steps.filter(step => validationArtifacts.includes(step.with?.name))])
    assert.equal(enabled(step, false, true, "failure", { "failure-report": "success" }), false,
      "Successful diagnostics cannot make failed validation publish reusable artifacts or proof");
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
