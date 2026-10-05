// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { OTHER_SHA, REPOSITORY, post } from "./support.mjs";

const badgePath = (name) => `.github/badges/version-dependency-${name}.svg`;
const branch = "feature/quotes-'and-#%";

function git(project, ...args)
{
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", project, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function checkout(world, changed, suffix = "project")
{
  const project = join(world.automation.root, suffix);
  mkdirSync(join(project, ".github/badges"), { recursive: true });
  for (const name of ["changed", "retired", "stable"])
    writeFileSync(join(project, badgePath(name)), `<svg>${name}</svg>\n`);
  writeFileSync(join(project, "README.md"), "original documentation\n");
  git(project, "init", "--initial-branch=main");
  git(project, "add", ".");
  git(project, "-c", "user.name=Badge test", "-c", "user.email=badges@example.test", "commit", "-qm", "fixture");
  const sha = git(project, "rev-parse", "HEAD");
  if (changed)
  {
    writeFileSync(join(project, badgePath("changed")), "<svg>updated &amp; escaped</svg>\n");
    writeFileSync(join(project, badgePath("added")), "<svg>new badge</svg>\n");
    rmSync(join(project, badgePath("retired")));
  }
  // These changes must never enter the API payload, including the staged file.
  writeFileSync(join(project, "README.md"), "unrelated documentation\n");
  git(project, "add", "README.md");
  writeFileSync(join(project, ".github/badges/diagram.svg"), "unrelated diagram\n");
  const summary = join(world.automation.root, `${suffix}-summary.md`);
  return { project, sha, branch, summary, status: git(project, "status", "--porcelain=v1", "--untracked-files=all"), changed };
}

function remoteHead(state, ref = { target: { oid: state.sha } })
{
  return post("graphql", { data: { repository: { ref } } });
}

function publish(world, state, responses)
{
  return world.automation.execute("publish-dependency-badges.sh",
    [state.repository ?? REPOSITORY, state.branch, state.sha, state.project], responses,
    { success: null, env: { GITHUB_STEP_SUMMARY: state.summary } });
}

Given("a pinned checkout without dependency badge changes", function ()
{
  this.publication = checkout(this, false);
});

Given("a pinned checkout with dependency badge changes", function ()
{
  this.publication = checkout(this, true);
});

Given("the publication branch is {string}", function (state)
{
  this.publication.responses = [remoteHead(this.publication, state === "deleted" ? null : { target: { oid: OTHER_SHA } })];
});

Given("the badge publication API fails during {string}", function (operation)
{
  const token = this.automation.env.GH_TOKEN;
  const failure = operation === "racing"
    ? post("graphql", { errors: [{ message: "expectedHeadOid does not match branch head" }] })
    : post("graphql", {}, {
      exit_code: 1,
      stderr: `gh: ${operation === "reading" ? "HTTP 403: resource not accessible" : "HTTP 422: commit rejected"} ${token}\n`
    });
  this.publication.responses = operation === "reading" ? [failure] : [remoteHead(this.publication), failure];
});

When("dependency badges are published", function ()
{
  const state = this.publication;
  const responses = state.responses ?? (state.changed ? [remoteHead(state), post("graphql", {
    data: { createCommitOnBranch: { commit: { oid: OTHER_SHA, url: `https://github.com/${REPOSITORY}/commit/${OTHER_SHA}` } } }
  })] : []);
  this.result = publish(this, state, responses);
});

Then("publication reports no commit and makes no remote request", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.ok(this.result.stdout.includes("no commit needed"), this.result.stdout);
  assert.deepEqual(this.automation.calls(), []);
  assert.equal(git(this.publication.project, "status", "--porcelain=v1", "--untracked-files=all"), this.publication.status);
});

Then("publication sends only changed added and deleted badges with an expected head", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const calls = this.automation.calls();
  assert.equal(calls.length, 2);
  for (const call of calls)
  {
    assert.equal(call.method, "POST");
    assert.equal(call.endpoint, "graphql");
    assert.deepEqual(call.fields, {});
    assert.ok(!call.body.query.includes(branch), "Branch names belong in JSON variables, not the GraphQL source");
  }
  assert.deepEqual(calls[0].body.variables, {
    owner: "superhero", name: "operations.superduper.solutions", ref: `refs/heads/${branch}`
  });
  assert.ok(calls[1].body.query.includes("createCommitOnBranch"));
  assert.deepEqual(calls[1].body.variables.input, {
    branch: { repositoryNameWithOwner: REPOSITORY, branchName: branch },
    expectedHeadOid: this.publication.sha,
    message: { headline: "chore: refresh dependency badges" },
    fileChanges: {
      additions: ["added", "changed"].map((name) => ({ path: badgePath(name),
        contents: readFileSync(join(this.publication.project, badgePath(name))).toString("base64") })),
      deletions: [{ path: badgePath("retired") }]
    }
  });
});

Then("publication reports its commit URL without changing the checkout", function ()
{
  assert.ok(this.result.stdout.includes(`https://github.com/${REPOSITORY}/commit/${OTHER_SHA}`), this.result.stdout);
  assert.equal(readFileSync(this.publication.summary, "utf8").trim(), this.result.stdout.trim().replaceAll("'", "&apos;"));
  assert.equal(git(this.publication.project, "status", "--porcelain=v1", "--untracked-files=all"), this.publication.status);
  assert.equal(git(this.publication.project, "rev-parse", "HEAD"), this.publication.sha);
});

Then("publication skips the {string} branch without creating a commit", function (state)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.ok(this.result.stdout.includes(`branch ${state === "deleted" ? "was deleted" : "advanced"}`), this.result.stdout);
  assert.equal(this.automation.calls().length, 1);
  assert.ok(readFileSync(this.publication.summary, "utf8").includes("publication skipped"));
  assert.equal(git(this.publication.project, "status", "--porcelain=v1", "--untracked-files=all"), this.publication.status);
});

Then("publication fails with {string} and branch context", function (reason)
{
  assert.notEqual(this.result.status, 0);
  for (const value of [reason, REPOSITORY, branch, this.publication.sha])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.equal(git(this.publication.project, "status", "--porcelain=v1", "--untracked-files=all"), this.publication.status);
});

Then("badge publication rejects unsafe paths and invalid targets without remote requests", function ()
{
  const outside = join(this.automation.root, "outside");
  mkdirSync(outside);
  const target = join(outside, "sentinel.svg");
  writeFileSync(target, "outside sentinel");
  for (const problem of ["linked-badge", "linked-directory", "unsafe-name", "invalid-ref", "invalid-sha", "wrong-sha", "invalid-repository"])
  {
    const state = checkout(this, true, problem);
    if (problem === "linked-badge")
    {
      rmSync(join(state.project, badgePath("changed")));
      symlinkSync(target, join(state.project, badgePath("changed")));
    }
    if (problem === "linked-directory")
    {
      renameSync(join(state.project, ".github/badges"), join(state.project, "saved-badges"));
      symlinkSync(outside, join(state.project, ".github/badges"));
    }
    if (problem === "unsafe-name") writeFileSync(join(state.project, badgePath("bad name")), "unsafe");
    if (problem === "invalid-ref") state.branch = "feature/../bad";
    if (problem === "invalid-sha") state.sha = "bad-sha";
    if (problem === "wrong-sha") state.sha = OTHER_SHA;
    if (problem === "invalid-repository") state.repository = "owner/repository/extra";
    const result = publish(this, state, []);
    assert.notEqual(result.status, 0, problem);
    assert.ok(result.stderr.includes("::error::"), result.stderr);
    assert.equal(readFileSync(target, "utf8"), "outside sentinel");
  }
  assert.deepEqual(this.automation.calls(), []);
});
