// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { parseDocument } from "yaml";
import { formatChangelog } from "../scripts/changelog.mjs";
import { REPOSITORY, SHA } from "./support.mjs";

function git(world, ...args)
{
  const result = spawnSync("git", args, { cwd: world.integrationRecovery.root, encoding: "utf8",
    env: { ...process.env, ...world.automation.env, GIT_CONFIG_NOSYSTEM: "1" }, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

Given("a pinned merged release with {string}", function (condition)
{
  const root = join(this.automation.root, "integration-recovery");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  copyFileSync(new URL("../scripts/changelog.mjs", import.meta.url), join(root, ".github/scripts/changelog.mjs"));
  this.integrationRecovery = { root, condition };
  git(this, "init", "-q", "--initial-branch=release/1.2.3");
  git(this, "config", "user.name", "Integration recovery fixture");
  git(this, "config", "user.email", "recovery@example.invalid");
  git(this, "config", "commit.gpgsign", "false");
  const entry = { sha: SHA, message: "fix: preserve the published release", repository: REPOSITORY };
  const document = formatChangelog(condition === "unreleased Latest entries"
    ? { staging: [entry], releases: [] }
    : { staging: [], releases: [{ version: condition === "a different release version" ? "1.2.2" : "1.2.3", entries: [entry] }] });
  const path = join(root, "CHANGELOG.md");
  switch (condition)
  {
    case "a canonical versioned changelog":
    case "a deleted release branch":
    case "unreleased Latest entries":
    case "a different release version": writeFileSync(path, document); break;
    case "a symbolic-link changelog":
      writeFileSync(join(root, "release-notes.md"), document);
      symlinkSync("release-notes.md", path);
      break;
    case "an executable changelog": writeFileSync(path, document); chmodSync(path, 0o755); break;
    case "a changelog directory": mkdirSync(path); writeFileSync(join(path, "notes.md"), document); break;
    case "a missing changelog": break;
    default: assert.fail(`Unknown merged release condition: ${condition}`);
  }
  git(this, "add", ".");
  git(this, "commit", "-qm", "The exact published source");
  this.integrationRecovery.head = git(this, "rev-parse", "HEAD");
  if (condition === "a deleted release branch")
  {
    git(this, "checkout", "--detach", "-q");
    git(this, "branch", "-D", "release/1.2.3");
  }
  this.integrationRecovery.refs = git(this, "for-each-ref", "--format=%(refname) %(objectname)");
  this.integrationRecovery.tree = git(this, "status", "--porcelain");
});

When("the merged release changelog recovery script runs", function ()
{
  const document = parseDocument(readFileSync(new URL("../workflows/ci-main.yml", import.meta.url), "utf8"));
  assert.deepEqual(document.errors, []);
  const step = document.toJS().jobs["release-changelog"].steps.find(candidate => candidate.id === "prepare");
  assert.equal(step.env.RECOVER_MERGED, "${{ needs.integration.outputs.recovery }}");
  writeFileSync(this.automation.env.MOCK_QUEUE, "[]");
  const state = this.integrationRecovery;
  state.result = spawnSync("bash", ["-e", "-c", step.run], { cwd: state.root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...this.automation.env, RECOVER_MERGED: "true", HEAD_BRANCH: "release/1.2.3",
      HEAD_SHA: state.head, GH_TOKEN: "", REPOSITORY, PR_NUMBER: "37" } });
  assert.ifError(state.result.error);
  state.diagnostics = state.result.stdout + state.result.stderr;
});

Then("merged release changelog recovery is {string} without writes", function (outcome)
{
  const state = this.integrationRecovery;
  assert.equal(state.result.status === 0, outcome === "ready", state.diagnostics);
  assert.equal(readFileSync(this.automation.output, "utf8"), outcome === "ready" ? "ready=true\n" : "");
  if (outcome === "unversioned") assert.match(state.diagnostics, /merged release changelog is not versioned/);
  if (outcome === "irregular") assert.match(state.diagnostics, /requires a regular versioned changelog/);
  assert.deepEqual(this.automation.calls(), [], "Recovery must not query or update a deleted source branch or create a docs PR");
  assert.equal(readFileSync(this.automation.env.MOCK_ERRORS, "utf8"), "", state.diagnostics);
  assert.equal(git(this, "for-each-ref", "--format=%(refname) %(objectname)"), state.refs);
  assert.equal(git(this, "rev-parse", "HEAD"), state.head);
  assert.equal(git(this, "status", "--porcelain"), state.tree, "Recovery must not rewrite published content");
});
