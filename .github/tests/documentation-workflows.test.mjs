// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, Then, When } from "@cucumber/cucumber";
import { parseDocument } from "yaml";

const BASE_SHA = "${{ needs.integration.outputs.base_sha }}";
const HEAD_SHA = "${{ github.event.pull_request.head.sha }}";

function workflow(name)
{
  const document = parseDocument(readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), "utf8"), {
    uniqueKeys: true
  });
  assert.deepEqual(document.errors, [], `${name} must be valid YAML`);
  return document.toJS();
}

function condition(expression, { source = "docs/readme", target = "main", fork = false, draft = false, updated = false, runRelease = true, integrationReady = true, results = {}, cancelled = false } = {})
{
  assert.equal(typeof expression, "string", "The job or step must explicitly guard its route");
  const github = {
    head_ref: source,
    base_ref: target,
    repository: "owner/project",
    event: { pull_request: { draft, head: { repo: { full_name: fork ? "fork/project" : "owner/project" } } } }
  };
  // These checked-in job conditions use GitHub's Boolean/string expression subset.
  const evaluate = new Function("github", "startsWith", "steps", "needs", "cancelled", "vars", `return (${expression
    .replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1").replace(/needs\.([\w-]+)/g, 'needs["$1"]')});`);
  const needs = { integration: { outputs: { ready: String(integrationReady) } }, "release-route": { outputs: { run_release: String(runRelease) } }, validation: { outputs: { reused: "false" } }, "release-changelog": { outputs: { ready: "true" } }, "prepare-changelog": { outputs: { updated: String(updated) } }, 'validation-prepare': { outputs: { has_work: 'true' } } };
  for (const name of ['integration', 'validation', 'workflow-checks', 'validate-pr', 'application',
    'preview', 'auto-merge', 'create-release-tag', 'release-changelog'])
  {
    needs[name] ??= {};
    needs[name].result = results[name] ?? 'success';
  }
  return evaluate(github, (value, prefix) => value.toLowerCase().startsWith(prefix.toLowerCase()),
    { prepare: { outputs: { updated: String(updated) } } },
    needs, () => cancelled, { CI_INCREMENTAL_TESTS: 'true' });
}

Given("the documentation workflow configuration", function ()
{
  this.documentationWorkflow = workflow("ci-docs");
});

When("the documentation source is {string} targeting {string}", function (source, target)
{
  this.documentationRoute = { source, target };
});

Then("the dedicated documentation job is {string}", function (outcome)
{
  const configuration = this.documentationWorkflow;
  assert.deepEqual(Object.keys(configuration.on), ["pull_request_target"]);
  assert.deepEqual(configuration.on.pull_request_target.branches, ["main", "develop", "release/**"]);
  assert.deepEqual(configuration.on.pull_request_target.types, ["opened", "synchronize", "reopened", "edited", "ready_for_review"]);
  assert.equal(condition(configuration.jobs.documentation.if, this.documentationRoute), outcome === "enabled");
  assert.equal(condition(configuration.jobs.documentation.if, { ...this.documentationRoute, integrationReady: false }), false,
    "Documentation must not validate or merge a stale candidate");
});

Then("documentation branches skip every regular job on that target", function ()
{
  const { target } = this.documentationRoute;
  const regular = workflow(`ci-${target.startsWith("release/") ? "release" : target}`);
  assert.deepEqual(Object.keys(regular.on), ["pull_request"]);
  for (const [name, job] of Object.entries(regular.jobs))
  {
    assert.equal(condition(job.if, { source: "docs/readme", target }), false,
      `${target}/${name} must not run tests or publish documentation-only changes`);
  }
  assert.equal(condition(regular.jobs["workflow-checks"].if, { source: "feature/editor", target }), true,
    "Ordinary changes must still run automation checks");
});

Then("documentation validation uses only trusted default-branch code and pinned Git objects", function ()
{
  const configuration = this.documentationWorkflow;
  assert.deepEqual(configuration.permissions, { actions: "read", contents: "read", "pull-requests": "read" });
  const policy = JSON.parse(readFileSync(new URL("../policies/documentation-events.json", import.meta.url), "utf8"));
  assert.equal(policy.enforcement, "active");
  assert.deepEqual(policy.conditions, {
    workflow_path: { include: [".github/workflows/ci-docs.yml"], exclude: [] }
  });
  assert.deepEqual(policy.rules, [{
    type: "restrict_action_events", parameters: { allowed_events: ["pull_request_target"] }
  }]);
  const job = configuration.jobs.documentation;
  assert.equal(job.permissions, undefined);
  assert.equal(job["continue-on-error"], undefined);
  const [checkout, fetch, validation] = job.steps;
  assert.equal(checkout.uses, "actions/checkout@v7");
  assert.deepEqual(checkout.with, { ref: "${{ github.sha }}", "fetch-depth": 0, "persist-credentials": false });
  assert.deepEqual(fetch.env, { GH_TOKEN: "${{ github.token }}", BASE_SHA, HEAD_SHA });
  assert.match(fetch.run, /\[\[ "\$BASE_SHA" =~ \^\[0-9a-f\]\{40\}\$ && "\$HEAD_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(fetch.run, /GIT_CONFIG_COUNT=1/);
  assert.match(fetch.run, /GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$authorization"/);
  assert.match(fetch.run, /::add-mask::\$authorization/);
  assert.match(fetch.run, /git fetch --no-tags origin "\$BASE_SHA" "\$HEAD_SHA"/);
  assert.doesNotMatch(fetch.run, /\b(?:checkout|switch|reset|worktree|submodule|config --global|config --local)\b/);
  assert.doesNotMatch(fetch.run, /\$\{\{/);
  assert.equal(validation.env.HEAD_SHA, HEAD_SHA);
  assert.equal(validation.env.BASE_SHA, BASE_SHA);
  assert.equal(validation.env.GH_TOKEN, "${{ github.token }}", "Release target validation needs read-only API access");
  assert.equal(validation.run.trim(), [
    'bash .github/scripts/validate-pr.sh "$REPOSITORY" "$HEAD_BRANCH" "$BASE_BRANCH" "$HEAD_SHA"',
    'bash .github/scripts/validate-documentation-changes.sh "$BASE_SHA" "$HEAD_SHA"'
  ].join("\n"));
  for (const step of [checkout, fetch, validation])
  {
    assert.equal(step.if, undefined, "Validation must always run before credentials can be granted");
    assert.equal(step["continue-on-error"], undefined);
  }
});

Then("the documentation workflow performs no testing, deployment, tagging or synchronization", function ()
{
  const configuration = this.documentationWorkflow;
  assert.deepEqual(Object.keys(configuration.jobs), ["integration", "documentation"]);
  assert.equal(configuration.jobs.integration.uses, "./.github/workflows/prepare-integration.yml");
  assert.ok([configuration.jobs.documentation.needs].flat().includes("integration"));
  const steps = configuration.jobs.documentation.steps;
  assert.equal(steps.length, 7, "Only trusted validation, optional Latest preparation and merge are needed");
  assert.deepEqual(steps.filter(step => step.uses).map(step => step.uses), [
    "actions/checkout@v7", "actions/create-github-app-token@v3"
  ]);
  const commands = steps.map(step => step.run ?? "").join("\n");
  assert.doesNotMatch(commands, /\b(?:npm|npx|node|cucumber|vite|wrangler|deploy|synchronize-release|create-release|git tag|git push)\b/);
  assert.doesNotMatch(JSON.stringify(configuration), /CLOUDFLARE|permission-deployments|workflow_dispatch|workflow_run|allow-unsafe-pr-checkout/);
});

Then("documentation writes follow validation with restricted credentials", function ()
{
  const [, , validation, timing, token, prepare, merge] = this.documentationWorkflow.jobs.documentation.steps;
  assert.match(validation.run, /validate-documentation-changes\.sh/);
  assert.equal(timing.run, 'bash .github/scripts/validate-documentation-merge.sh "$REPOSITORY" "$BASE_BRANCH"');
  assert.deepEqual(timing.env, {
    GH_TOKEN: "${{ github.token }}", REPOSITORY: "${{ github.repository }}", BASE_BRANCH: "${{ github.base_ref }}",
    DOCUMENTATION_MERGE_WAIT_SECONDS: "${{ startsWith(github.head_ref, 'docs/release-changelog-') && startsWith(github.base_ref, 'release/') && '120' || '0' }}"
  });
  assert.equal(token.uses, "actions/create-github-app-token@v3");
  assert.deepEqual(token.with, {
    "client-id": "${{ vars.GH_APP_CLIENT_ID }}",
    "private-key": "${{ secrets.GH_APP_PRIVATE_KEY }}",
    "permission-contents": "write",
    "permission-pull-requests": "write"
  });
  for (const step of [timing, token, merge])
  {
    assert.equal(condition(step.if), true);
    assert.equal(condition(step.if, { fork: true }), false);
    assert.equal(condition(step.if, { draft: true }), false);
    assert.doesNotMatch(step.if, /\b(?:always|failure|cancelled)\s*\(/,
      "Write steps must retain the default success prerequisite");
    assert.equal(step["continue-on-error"], undefined);
  }
  assert.equal(condition(prepare.if, { target: "main" }), false);
  assert.equal(condition(prepare.if, { target: "develop" }), true);
  assert.equal(condition(prepare.if, { target: "develop", fork: true }), false);
  assert.equal(condition(prepare.if, { target: "develop", draft: true }), false);
  assert.equal(prepare.id, "prepare");
  assert.match(prepare.run, /bash \.github\/scripts\/prepare-changelog\.sh/);
  assert.equal(prepare.env.GH_TOKEN, "${{ steps.app-token.outputs.token }}");
  assert.equal(prepare.env.BASE_SHA, BASE_SHA);
  assert.equal(prepare.env.HEAD_SHA, HEAD_SHA);
  assert.equal(condition(merge.if, { target: "develop", updated: true }), false,
    "The generated source head must receive its own validation before merging");
  assert.equal(merge.env.GH_TOKEN, "${{ steps.app-token.outputs.token }}");
  assert.equal(merge.env.BASE_SHA, BASE_SHA);
  assert.equal(merge.env.HEAD_SHA, HEAD_SHA);
  assert.equal(merge.env.HEAD_BRANCH, "${{ github.head_ref }}");
  assert.equal(merge.env.BASE_BRANCH, "${{ github.base_ref }}");
  assert.equal(merge.run, 'bash .github/scripts/auto-merge.sh "$REPOSITORY" "$PR_NUMBER" "$HEAD_SHA" "$BASE_BRANCH" "$BASE_SHA" "$HEAD_BRANCH"');
});

Then("documentation merging shares the global integration queue and destination merge lock", function ()
{
  const lock = this.documentationWorkflow.jobs.documentation.concurrency;
  assert.deepEqual(lock, { group: "merge-${{ github.base_ref }}", "cancel-in-progress": false });
  for (const target of ["main", "develop", "release"])
    assert.deepEqual(workflow(`ci-${target}`).jobs["auto-merge"].concurrency, lock);
  const outer = this.documentationWorkflow.concurrency;
  assert.deepEqual(outer, { group: "integration-ci", "cancel-in-progress": false, queue: "max" });
  for (const target of ["main", "develop", "release", "support"])
    assert.deepEqual(workflow(`ci-${target}`).concurrency, outer, `${target} must serialize with documentation throughout validation and publication`);
  assert.notEqual(lock.group, outer.group, "Documentation must not wait for its own workflow lock");
});

Then("a documentation-only release advance cannot reach application or publication jobs", function ()
{
  const jobs = workflow("ci-main").jobs;
  for (const root of ["workflow-checks", "validate-pr"])
  {
    assert.ok([jobs[root].needs].flat().includes("release-route"));
    assert.equal(condition(jobs[root].if, { source: "release/1.2.3", runRelease: false }), false);
    assert.equal(condition(jobs[root].if, { source: "release/1.2.3", runRelease: true }), true);
  }
  const reached = new Set(["integration", "release-route"]);
  for (const [name, job] of Object.entries(jobs))
  {
    if (name === "integration" || name === "release-route") continue;
    const dependencies = Array.isArray(job.needs) ? job.needs : [job.needs];
    assert.doesNotMatch(job.if, /\b(?:always|failure)\s*\(/, "Downstream jobs must retain successful prerequisites");
    if (/\bcancelled\s*\(/.test(job.if)) {
      assert.match(job.if, /!cancelled\(\)/);
      assert.equal(condition(job.if, { source: 'release/1.2.3', cancelled: true }), false);
      if (name === 'application')
        assert.equal(job.steps[0].name, 'Require successful preparation and quick gates');
      else
        for (const dependency of dependencies)
          for (const result of ['failure', 'cancelled', 'skipped'])
            assert.equal(condition(job.if, { source: 'release/1.2.3', results: { [dependency]: result } }), false,
              `${name} must retain successful ${dependency} before publication`);
    }
    assert.ok(dependencies.every(dependency => Object.hasOwn(jobs, dependency)), `${name} requires known routing dependencies`);
    if (dependencies.every(dependency => reached.has(dependency)) &&
      condition(job.if, { source: "release/1.2.3", runRelease: false })) reached.add(name);
  }
  assert.deepEqual([...reached], ["integration", "release-route"]);
});
