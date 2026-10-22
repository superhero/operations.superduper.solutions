// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { parseDocument } from "yaml";
import { inventory } from "../scripts/validation-artifacts.mjs";

const requiredSuites = [
  "test:automation", "typecheck", "test:source:coverage", "test:runner", "test:coverage",
  "build", "test:acceptance", "test:browser"
];
const reportChecks = ["report:tests", "badges:scenarios", "badges:coverage"];
const validationArtifacts = ["bundle", "coverage", "test-report"];

function enabled(step, reused, ready = true, status = "success", outcomes = {}, integration = {})
{
  const condition = step.if ?? "true";
  // GitHub applies success() implicitly unless the condition uses a status function.
  if (status !== "success" && !/\b(?:success|always|failure|cancelled)\s*\(/.test(condition)) return false;
  const expression = condition.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")
    .replace(/\b(needs|steps)\.([\w-]+)/g, '$1["$2"]');
  const needs = {
    integration: { outputs: { ready: String(integration.ready ?? true), recovery: String(integration.recovery ?? false) } },
    validation: { outputs: { reused: String(reused) } },
    "release-route": { outputs: { run_release: "true" } },
    "release-changelog": { outputs: { ready: String(ready) } },
    "prepare-changelog": { outputs: { updated: "false" } }
  };
  const github = {
    head_ref: integration.source ?? "release/1.2.3", base_ref: "main", repository: "owner/project",
    event: { pull_request: { draft: false, head: { repo: { full_name: "owner/project" } } } }
  };
  const steps = Object.fromEntries(["automation", "source", "browser", "failure-report", "prepared"]
    .map(id => [id, { outcome: outcomes[id] ?? status }]));
  const env = { CI_INCREMENTAL_TESTS: 'false' }, vars = { CI_INCREMENTAL_TESTS: 'false' };
  needs['validation-prepare'] = { result: 'skipped', outputs: { has_work: 'false' } };
  for (const name of ['integration', 'validation', 'workflow-checks', 'validate-pr', 'application',
    'preview', 'auto-merge', 'create-release-tag', 'release-changelog'])
  {
    needs[name] ??= {};
    needs[name].result = integration.results?.[name] ?? 'success';
  }
  return new Function("needs", "github", "steps", "env", "vars", "startsWith", "success", "always", "failure", "cancelled", `return (${expression});`)(
    needs, github, steps, env, vars, (value, prefix) => value.startsWith(prefix),
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

function publicationStages(jobs)
{
  return ['preview', 'auto-merge', 'create-release-tag', 'backmerge-develop', 'promote-release']
    .filter(name => jobs[name]).map(name => [name, jobs[name]]);
}

function completedValidation(jobs)
{
  return Object.fromEntries(Object.keys(jobs).map(name => [name,
    ['validation-prepare', 'browser-validation'].includes(name) ? 'skipped' : 'success']));
}

Then('publication continues after optional validation jobs are skipped', function ()
{
  const { jobs } = this.validationWorkflow;
  const results = completedValidation(jobs);
  for (const reused of [false, true])
    for (const [name, job] of publicationStages(jobs))
      assert.equal(enabled(job, reused, true, 'skipped', {}, { results }), true,
        `${this.validationTarget}/${name} must run after successful aggregation despite skipped ancestors`);
});

Then('failed or cancelled required jobs still block every publication stage', function ()
{
  const { jobs } = this.validationWorkflow;
  const results = completedValidation(jobs);
  for (const [name, job] of publicationStages(jobs))
    for (const reused of [false, true])
    {
      assert.equal(enabled(job, reused, true, 'cancelled', {}, { results }), false,
        `${name} cannot publish after workflow cancellation`);
      for (const dependency of [job.needs].flat())
        for (const result of ['failure', 'cancelled', 'skipped'])
          assert.equal(enabled(job, reused, true, result, {}, {
            results: { ...results, [dependency]: result }
          }), false, `${name} must stop when required ${dependency} is ${result}`);
    }
});

Then("integration workflows share one retained queue without acquiring their own lock twice", function ()
{
  const queue = { group: "integration-ci", "cancel-in-progress": false, queue: "max" };
  const preparation = parseDocument(readFileSync(new URL("../workflows/prepare-integration.yml", import.meta.url), "utf8"));
  assert.deepEqual(preparation.errors, []);
  const reusable = preparation.toJS();
  assert.equal(reusable.concurrency, undefined, "The reusable preparation must not wait on its caller's integration lock");
  for (const [name, job] of Object.entries(reusable.jobs))
    assert.notEqual(job.concurrency?.group, queue.group, `${name} cannot acquire the caller's integration lock`);
  for (const name of ["ci-develop", "ci-release", "ci-main", "ci-support", "ci-docs", "cron-outdated", "test-develop"])
  {
    const document = parseDocument(readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), "utf8"));
    assert.deepEqual(document.errors, []);
    const workflow = document.toJS();
    assert.deepEqual(workflow.concurrency, queue, `${name} must queue every integration and dependency update without cancellation`);
    for (const [id, job] of Object.entries(workflow.jobs))
      assert.notEqual(job.concurrency?.group, queue.group, `${name}/${id} cannot acquire its own workflow lock`);
  }
});

Then("queued preparation separates proposed inspection code from branch update credentials", function ()
{
  const document = parseDocument(readFileSync(new URL("../workflows/prepare-integration.yml", import.meta.url), "utf8"));
  assert.deepEqual(document.errors, []);
  const workflow = document.toJS();
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
  const { inspect, refresh } = workflow.jobs;
  assert.equal(inspect.permissions, undefined, "Inspection cannot elevate its read-only token");
  assert.doesNotMatch(JSON.stringify(inspect), /secrets\.|create-github-app-token|permission-contents|permission-pull-requests/,
    "Bootstrap code must never receive App credentials");
  const checkout = uniqueStep(inspect.steps, step => step.uses?.startsWith("actions/checkout@"), "Trusted preparation checkout");
  assert.equal(checkout.with.ref, "${{ github.event_name == 'pull_request_target' && github.sha || github.event.pull_request.base.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.deepEqual([refresh.needs].flat(), ["inspect"]);
  assert.match(refresh.if, /needs\.inspect\.outputs\.refresh == 'true'/);
  assert.match(refresh.if, /github\.event_name == 'pull_request'/,
    "Documentation events cannot take the branch mutation route");
  assert.deepEqual(refresh.steps.filter(step => step.uses).map(step => step.uses), ["actions/create-github-app-token@v3"],
    "The write job must not check out or execute proposed repository actions");
  const update = uniqueStep(refresh.steps, step => step.run?.includes("/update-branch"), "Candidate update");
  assert.equal(update.env.HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
  assert.match(update.run, /expected_head_sha=/, "The update must retain the original source-head lease");
  assert.doesNotMatch(update.run, /\.github\/scripts|git (?:checkout|show|switch)|\b(?:npm|npx)\b/,
    "The credentialed job must execute only its fixed API update");
  const inspection = inspect.steps.find(step => step.id === "prepare");
  assert.equal(inspection.env.RUN_ATTEMPT, "${{ github.run_attempt }}");
  assert.equal(inspection.env.EVENT_BASE_SHA, "${{ github.event.pull_request.base.sha }}");
  assert.equal(inspection.env.EVENT_SHA, "${{ github.sha }}");
  assert.equal(inspection.env.WORKFLOW_FILE, "${{ inputs.workflow-file }}");
  for (const output of ["ready", "recovery", "head_sha", "base_sha", "tested_sha"])
    assert.equal(workflow.on.workflow_call.outputs[output].value, `\${{ jobs.inspect.outputs.${output} }}`,
      "Updating a candidate cannot produce new validation evidence in the old run");
});

Then("an unprepared candidate cannot start any downstream integration job", function ()
{
  const { jobs } = this.validationWorkflow;
  assert.equal(jobs.integration.uses, "./.github/workflows/prepare-integration.yml");
  assert.equal(jobs.integration.with["workflow-file"], `.github/workflows/ci-${this.validationTarget}.yml`);
  assert.equal(jobs.integration.needs, undefined, "Preparation must precede every test and write job");
  for (const [name, job] of Object.entries(jobs))
  {
    if (name === "integration") continue;
    assert.ok([job.needs].flat().includes("integration"), `${name} must wait directly for the prepared candidate`);
    assert.equal(job["continue-on-error"], undefined);
    assert.doesNotMatch(job.if ?? "", /\b(?:always|failure)\s*\(/, `${name} cannot bypass failed preparation`);
    if (/\bcancelled\s*\(/.test(job.if ?? '')) assert.match(job.if, /!cancelled\(\)/);
    assert.doesNotMatch(JSON.stringify(job), /github\.event\.pull_request\.base\.sha/,
      `${name} must not use the stale event base after preparation`);
    for (const source of ["feature/editor", "bugfix/editor", "docs/readme", "release/1.2.3", "develop"])
      for (const ready of [false, ""])
        assert.equal(enabled(job, false, true, "success", {}, { source, ready }), false,
          `${name} must stay blocked for ${source} when integration.ready is ${JSON.stringify(ready)}`);
    if (this.validationTarget === "support")
      for (const checkout of (job.steps ?? []).filter(step => step.uses?.startsWith("actions/checkout@")))
        assert.equal(checkout.with?.ref, "${{ needs.integration.outputs.tested_sha }}",
          `${name} must test and merge the prepared support candidate`);
  }
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

Then("artifact staging removes only empty generated directories", function ()
{
  const { create } = validationProof(this.validationWorkflow.jobs);
  const proof = create.run.indexOf("node .github/scripts/validation-artifacts.mjs create");
  assert.ok(proof > 0, "The real staging commands must precede proof creation");
  const root = mkdtempSync(join(tmpdir(), "operations-artifact-staging-"));
  const write = (path, value) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  };
  const entries = directory => Object.entries(inventory(join(root, directory))).sort();
  try
  {
    write("dist/index.html", "tested bundle\n");
    write("dist/_headers", "tested headers\n");
    write("tmp/test/coverage/index.html", "source coverage\n");
    write("tmp/test/coverage/coverage-summary.json", "source coverage totals\n");
    write("tmp/test/report/index.html", "combined report\n");
    write("tmp/test/report/ui/assets/index.js", "tested report JavaScript\n");
    write("tmp/test/report/coverage/index.html", "merged coverage\n");
    write("tmp/test/badges/test-coverage.svg", "tested coverage badge\n");
    write("tmp/test/badges/test-scenarios.svg", "tested scenario badge\n");
    const expected = {
      bundle: entries("dist"), coverage: entries("tmp/test/coverage"),
      "test-report": [...entries("tmp/test/report"), ...entries("tmp/test/badges")
        .map(([path, hash]) => [`badges/${path}`, hash])].sort(),
    };
    for (const directory of ["dist/assets", "tmp/test/coverage/cache/empty",
      "tmp/test/report/ui/empty", "tmp/test/badges/pending"])
      mkdirSync(join(root, directory), { recursive: true });
    write("tmp/test/coverage/v8/raw.json", "unpublished raw counters\n");
    const outside = join(root, "outside/empty");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, "tmp/test/report/linked-output"));
    const result = spawnSync("bash", ["-euc", create.run.slice(0, proof)],
      { cwd: root, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    const link = join(root, "tmp/validation/test-report/linked-output");
    assert.ok(lstatSync(link).isSymbolicLink(), "Staging must leave symlinks for strict verification");
    assert.equal(readlinkSync(link), outside);
    assert.ok(existsSync(outside), "Empty directories outside the staged outputs must remain intact");
    rmSync(link);
    for (const name of validationArtifacts)
      assert.deepEqual(entries(`tmp/validation/${name}`), expected[name], `${name} must preserve every file and hash`);
    symlinkSync(outside, link);
    assert.throws(() => inventory(join(root, "tmp/validation/test-report")), /symlink/);
    assert.ok(existsSync(join(root, "tmp/test/coverage/v8/raw.json")), "Staging must not alter original evidence");
    assert.equal(existsSync(join(root, "tmp/validation/coverage/v8")), false);
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

Then("release artifacts remain bound to the exact tested checkout", function ()
{
  const { jobs } = this.validationWorkflow;
  const expected = this.validationTarget === "main"
    ? "${{ github.event.pull_request.head.sha }}" : "${{ needs.integration.outputs.tested_sha }}";
  const checkout = jobs.application.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  const automationCheckout = uniqueStep(jobs["workflow-checks"].steps,
    step => step.uses?.startsWith("actions/checkout@"), "Automation checkout");
  const proof = jobs.application.steps.find(step => step.run?.includes("validation-artifacts.mjs create"));
  const report = jobs.application.steps.find(step => step.id === "report");
  assert.equal(checkout.with.ref, expected);
  assert.equal(automationCheckout.with?.ref, expected, "Automation and application must test the same prepared revision");
  const lookupCheckout = uniqueStep(jobs.validation.steps,
    step => step.uses?.startsWith("actions/checkout@"), "Validation lookup checkout");
  assert.equal(lookupCheckout.with.ref, expected, "Validation lookup must fingerprint the candidate that will actually run");
  assert.equal(jobs.validation.steps.find(step => step.id === "find").env.TARGET_SHA, expected);
  assert.equal(enabled(automationCheckout, false), true);
  assert.equal(proof.env.TESTED_SHA, expected);
  assert.equal(report.env.REPORT_COMMIT, expected);
  assert.equal(proof.env.PR_HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
  for (const [name, job] of Object.entries(jobs))
    for (const step of job.steps ?? [])
      if (Object.hasOwn(step.env ?? {}, "BASE_SHA"))
        assert.equal(step.env.BASE_SHA, "${{ needs.integration.outputs.base_sha }}", `${name}/${step.name} must retain the fresh target pin`);
  assert.match(proof.run, /"\$GITHUB_RUN_ID" "\$GITHUB_RUN_ATTEMPT"/);
  for (const [name, path] of Object.entries({ bundle: "tmp/validation/bundle", coverage: "tmp/validation/coverage", "test-report": "tmp/validation/test-report" }))
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
    assert.doesNotMatch(job.if ?? "", /\b(?:always|failure)\s*\(/);
    if (/\bcancelled\s*\(/.test(job.if ?? '')) assert.match(job.if, /!cancelled\(\)/);
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
  const token = uniqueStep(prepare.steps, step => step.uses?.startsWith("actions/create-github-app-token@"), "Release changelog token");
  assert.equal(enabled(token, false, true, "success", {}, { source: "release/1.2.3", recovery: false }), true);
  assert.equal(enabled(token, false, true, "success", {}, { source: "release/1.2.3", recovery: true }), false,
    "Exact merged release recovery must not obtain write credentials");
  for (const recovery of [false, true])
    assert.equal(enabled(token, false, true, "success", {}, { source: "hotfix/1.2.4", recovery }), false);
  assert.equal(prepare.steps.find(step => step.id === "prepare").env.RECOVER_MERGED, "${{ needs.integration.outputs.recovery }}");
});

Then("develop builds and merges without test execution or validation proof", function ()
{
  const { jobs } = this.validationWorkflow;
  assert.equal(jobs.validation, undefined, "A preview build must not claim reusable test validation");
  const commands = npmCommands(jobs).map(({ command }) => command);
  assert.deepEqual(commands.filter(command => command.startsWith("test:") || command.startsWith("report:")), []);
  assert.equal(commands.filter(command => command === "build").length, 1);
  assert.equal(commands.filter(command => command === "typecheck").length, 1);
  const allSteps = Object.values(jobs).flatMap(job => job.steps ?? []);
  assert.ok(!allSteps.some(step => step.with?.name === "validation-manifest" || step.run?.includes("validation-artifacts.mjs create")));
  const bundle = uniqueStep(jobs.application.steps, step => step.with?.name === "bundle", "Preview bundle");
  assert.equal(bundle.with.path, "dist");
  for (const required of ["integration", "workflow-checks", "validate-pr", "prepare-changelog"])
    assert.ok(jobs.application.needs.includes(required));
  assert.ok(jobs["auto-merge"].needs.includes("application"));
  assert.ok(jobs.preview.needs.includes("auto-merge"));
  requiresSuccess(jobs.application);
  requiresSuccess(jobs["auto-merge"]);
  assert.match(jobs.preview.steps.find(step => step.run?.includes("--name bundle")).run, /GITHUB_RUN_ID/);
});

Then("the manual develop workflow runs all suites only for the develop branch", function ()
{
  const workflow = parseDocument(readFileSync(new URL("../workflows/test-develop.yml", import.meta.url), "utf8")).toJS();
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const { jobs } = workflow;
  const guard = jobs["validate-target"].steps[0];
  assert.equal(guard.env.TARGET_REF, "${{ github.ref }}");
  for (const ref of ["refs/heads/develop", "refs/heads/main", "refs/heads/feature/topic", "refs/tags/develop"])
  {
    const result = spawnSync("bash", ["-e", "-c", guard.run], { env: { ...process.env, TARGET_REF: ref } });
    assert.equal(result.status === 0, ref === "refs/heads/develop");
  }
  for (const name of ["workflow-checks", "application"])
  {
    assert.ok([jobs[name].needs].flat().includes("validate-target"));
    const checkout = jobs[name].steps.find(step => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ github.sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
  }
  assert.ok(jobs.application.needs.includes("workflow-checks"));
  assert.deepEqual(npmCommands(jobs).filter(({ command }) => requiredSuites.includes(command)).map(({ command }) => command).sort(), [...requiredSuites].sort());
  assert.ok(jobs.application.steps.some(step => step.run?.includes("npm --loglevel=error run report:tests")));
  assert.ok(jobs.application.steps.some(step => step.with?.name === "test-report"));
  assert.doesNotMatch(JSON.stringify(jobs), /create-github-app-token|publish-status|validation-manifest|validation-artifacts\.mjs|pages deploy|auto-merge\.sh/,
    "Manual tests cannot merge, deploy, or certify release reuse");
});

Then("release preparation defers all suites until a release candidate exists", function ()
{
  const { jobs } = this.validationWorkflow;
  const source = { source: "develop" };
  assert.equal(enabled(jobs["create-release"], false, true, "success", {}, source), true);
  for (const { job, step } of npmCommands(jobs).filter(({ command }) => requiredSuites.includes(command)))
    assert.equal(enabled(jobs[job], false, true, "success", {}, source)
      && enabled(step, false, true, "success", {}, source), false,
      "A develop-to-main trigger must create the release before running its suites");
  assert.equal(enabled(jobs.application, false, true, "success", {}, { source: "release/1.2.3" }), true);
});

Then("report badges are generated from passing results and travel with validated reports", function ()
{
  const { jobs } = this.validationWorkflow;
  const steps = jobs.application.steps;
  const badges = uniqueStep(steps, step => npmScripts(step).includes("badges:scenarios"), "Report badges");
  assert.deepEqual(npmScripts(badges), ["badges:coverage", "badges:scenarios"]);
  assert.doesNotMatch(badges.run, /--check/);
  requiresSuccess(badges);
  assert.equal(enabled(badges, false), true);
  assert.equal(enabled(badges, true), false, "Reuse preserves the original badges");
  for (const command of ["test:coverage", "test:browser", "report:tests"])
    assert.ok(steps.findIndex(step => npmScripts(step).includes(command)) < steps.indexOf(badges));
  assert.ok(steps.filter(step => npmScripts(step).includes("test:coverage")).length === 1);
  const proof = validationProof(jobs).create;
  assert.ok(steps.indexOf(proof) > steps.indexOf(badges));
  assert.match(proof.run, /cp -a tmp\/test\/report\/\. tmp\/validation\/test-report\//);
  assert.match(proof.run, /cp -a tmp\/test\/badges tmp\/validation\/test-report\//);
  assert.doesNotMatch(steps.map(step => step.run ?? "").join("\n"), /badges:(?:scenarios|coverage)[^\n]*--check/);
  if (this.validationTarget === "main")
  {
    const publication = uniqueStep(Object.values(jobs).flatMap(job => job.steps ?? []),
      step => step.run?.includes("publish-report.mjs"), "Published report and badges");
    requiresSuccess(publication);
    assert.match(publication.run, /validate-current-release\.sh[^\n]+\n\s*node \.github\/scripts\/publish-report\.mjs/);
    assert.match(publication.run, /publish-report\.mjs tmp\/publication\/test-report "reports\/\$MERGE_SHA-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT" tmp\/publication\/validation-manifest\/validation-manifest\.json/);
    assert.doesNotMatch(publication.run, /generate-coverage-report|publish-status\.sh tmp\/test-coverage\.html/);
    const promotion = jobs['promote-release'];
    assert.ok(promotion.needs.includes('validation'));
    for (const [field, output] of Object.entries({ VALIDATION_RUN_ID: 'source_run_id',
      VALIDATION_RUN_ATTEMPT: 'source_run_attempt', VALIDATION_SOURCE_SHA: 'source_sha', VALIDATION_TESTED_SHA: 'tested_sha' }))
      assert.ok(promotion.env[field].includes(`needs.validation.outputs.${output}`), `${field} must retain original reused provenance`);
    const download = uniqueStep(promotion.steps, step => step.name === 'Download release artifacts', 'Downloaded validation proof');
    assert.match(download.run, /for name in bundle coverage test-report validation-manifest/);
    assert.match(download.run, /--name reused-validation --dir tmp\/publication/);
    assert.match(download.run, /validation-artifacts\.mjs verify tmp\/publication\/validation-manifest\/validation-manifest\.json tmp\/publication/);
    assert.ok(download.run.indexOf('validation-artifacts.mjs verify') < download.run.indexOf('cp -a tmp/publication/bundle/. dist/'));
    assert.ok(promotion.steps.indexOf(download) < promotion.steps.indexOf(publication));
    assert.ok(promotion.steps.indexOf(download) < promotion.steps.findIndex(step => step.name === 'Check production content and destination'));

  }
});

Then("publication retries use the producing attempt rather than the retry attempt", function ()
{
  const { jobs } = this.validationWorkflow;
  const application = jobs.application;
  const promotion = jobs['promote-release'];
  assert.equal(application.outputs.validation_run_attempt, '${{ steps.validation-proof.outputs.run_attempt }}');
  const producer = uniqueStep(application.steps, step => step.id === 'validation-proof', 'Validation producer attempt');
  assert.match(producer.run, /printf 'run_attempt=%s\\n' "\$GITHUB_RUN_ATTEMPT" >> "\$GITHUB_OUTPUT"/);
  assert.ok(promotion.needs.includes('application'));
  const expression = promotion.env.VALIDATION_RUN_ATTEMPT.replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  assert.doesNotMatch(expression, /github\.run_attempt/);
  const evaluate = new Function('needs', `return (${expression});`);
  for (const retryAttempt of ['2', '3']) {
    assert.equal(evaluate({ application: { outputs: { validation_run_attempt: '1' } },
      validation: { outputs: { reused: 'false' } } }), '1', `Promotion attempt ${retryAttempt} must retain producer attempt 1`);
  }
  assert.equal(evaluate({ application: { outputs: { validation_run_attempt: '2' } },
    validation: { outputs: { reused: 'false' } } }), '2', 'A full rerun uses its new producer attempt');
  assert.equal(evaluate({ application: { outputs: {} },
    validation: { outputs: { reused: 'true', source_run_attempt: '7' } } }), '7',
    'Reused validation retains the original external run attempt');
});

Then('the {string} workflow schedules only outstanding batches and fails closed at aggregation', function (name) {
  const document = parseDocument(readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), 'utf8'));
  assert.deepEqual(document.errors, []);
  const { jobs, env } = document.toJS(), prep = jobs['validation-prepare'], browser = jobs['browser-validation'], app = jobs.application;
  assert.match(env.CI_INCREMENTAL_TESTS, /vars\.CI_INCREMENTAL_TESTS != 'false'/);
  assert.match(prep.if, /vars\.CI_INCREMENTAL_TESTS != 'false'/);
  assert.equal(prep.permissions.actions, 'read'); assert.equal(prep.permissions.contents, 'read');
  assert.equal(prep.permissions['pull-requests'], 'read');
  for (const required of ['workflow-checks', 'validation-prepare']) assert.ok(browser.needs.includes(required));
  for (const required of ['workflow-checks', 'validation-prepare', 'browser-validation']) assert.ok(app.needs.includes(required));
  assert.equal(browser.strategy['max-parallel'], 4); assert.equal(browser.strategy['fail-fast'], false);
  assert.match(browser.strategy.matrix, /fromJSON\(needs\.validation-prepare\.outputs\.matrix/);
  assert.match(browser.if, /needs\.validation-prepare\.outputs\.has_work == 'true'/);
  const cache = uniqueStep(prep.steps, step => step.uses === './.github/actions/ci-browser', 'Cache planner');
  assert.equal(cache.with.mode, 'prepare');
  assert.ok(prep.steps.indexOf(cache) > prep.steps.findIndex(step => step.run?.includes('ci-prepare.mjs')));
  const run = uniqueStep(browser.steps, step => step.uses === './.github/actions/ci-browser', 'Browser checkpoints');
  assert.equal(run.with.mode, 'batch');
  assert.equal(run.env.GH_TOKEN, '${{ github.token }}');
  const gate = app.steps[0];
  assert.equal(gate.name, 'Require successful preparation and quick gates');
  const good = Object.fromEntries(Object.keys(gate.env).map(key => [key, key === 'VALIDATION_REUSED' ? 'false' : 'success']));
  function execute(step, values) {
    return spawnSync('bash', ['-euc', step.run], { env: { ...process.env, ...values }, encoding: 'utf8', timeout: 5000 });
  }
  for (const mode of ['true', 'false']) {
    assert.equal(execute(gate, { ...good, CI_INCREMENTAL_TESTS: mode }).status, 0);
    for (const key of Object.keys(good).filter(key => key !== 'VALIDATION_REUSED' && (mode === 'true' || key !== 'PREPARE_RESULT'))) {
      assert.notEqual(execute(gate, { ...good, CI_INCREMENTAL_TESTS: mode, [key]: 'failure' }).status, 0, `${key} failure must block ${mode} mode`);
    }
  }
  const batchGate = uniqueStep(app.steps, step => step.name === 'Require successful browser batches', 'Final batch gate');
  for (const hasWork of ['true', 'false']) for (const result of ['success', 'skipped', 'failure', 'cancelled'])
    assert.equal(execute(batchGate, { HAS_WORK: hasWork, BROWSER_BATCH_RESULT: result }).status === 0,
      hasWork === 'true' ? result === 'success' : result === 'skipped');
  const assemble = app.steps.findIndex(step => step.run?.includes('ci.mjs assemble'));
  assert.ok(assemble > 0 && assemble < app.steps.indexOf(batchGate));
  const report = app.steps.findIndex(step => step.id === 'report');
  if (report >= 0) assert.ok(report > app.steps.indexOf(batchGate));
  requiresSuccess(batchGate);
});
