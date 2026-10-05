// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";

function git(world, ...args)
{
  const result = spawnSync("git", args, { cwd: world.automation.root,
    env: { ...process.env, ...world.automation.env }, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function file(world, path, contents)
{
  const absolute = join(world.automation.root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  git(world, "add", "--", path);
}

Given("an integration with {string}", function (changes)
{
  git(this, "init", "-q", "--initial-branch=main");
  git(this, "config", "user.name", "Integration test");
  git(this, "config", "user.email", "integration@example.invalid");
  git(this, "config", "commit.gpgsign", "false");
  file(this, "application.ts", "original\n");
  git(this, "commit", "-qm", "Original application");
  const base = git(this, "rev-parse", "HEAD");
  file(this, "application.ts", "released\n");
  git(this, "commit", "-qm", "Released application");
  this.previewTarget = git(this, "rev-parse", "HEAD");
  git(this, "checkout", "-qb", "develop", changes === "application code renamed to a badge" ? this.previewTarget : base);
  file(this, "application.ts", changes === "conflicting code" ? "conflicting\n" : "released\n");
  if (changes === "new application code") file(this, "feature.ts", "new feature\n");
  if (changes === "only dependency badges") file(this, ".github/badges/version-dependency-typescript.svg", "orange\n");
  if (changes === "a quality assurance badge") file(this, ".github/badges/test-scenarios.svg", "new result\n");
  git(this, "commit", "--allow-empty", "-qm", "Squashed synchronization and current work");
  if (changes === "application code renamed to a badge")
  {
    const badge = ".github/badges/version-dependency-application.svg";
    mkdirSync(dirname(join(this.automation.root, badge)), { recursive: true });
    renameSync(join(this.automation.root, "application.ts"), join(this.automation.root, badge));
    git(this, "add", "--", "application.ts", badge);
    git(this, "commit", "-qm", "Rename application code");
  }
  this.previewHead = git(this, "rev-parse", "HEAD");
  this.previewSource = changes === "an unavailable commit" ? "f".repeat(40) : this.previewHead;
});

When("the integration is previewed", function ()
{
  this.previewResult = this.automation.execute("preview-merge.sh", [this.previewTarget, this.previewSource], [], { success: null });
});

Then("the preview reports substantive changes as {string} without changing the checkout", function (changed)
{
  assert.equal(this.previewResult.status, 0, this.previewResult.stderr);
  const preview = JSON.parse(this.previewResult.stdout);
  assert.equal(preview.substantive_changes, changed === "true");
  assert.equal(git(this, "cat-file", "-t", preview.tree), "tree");
  assert.equal(git(this, "rev-parse", "HEAD"), this.previewHead);
  assert.equal(git(this, "status", "--porcelain", "--untracked-files=no"), "");
});

Then("the preview fails with {string} and both commit SHAs", function (reason)
{
  assert.notEqual(this.previewResult.status, 0);
  assert.equal(this.previewResult.stdout, "");
  for (const context of [reason, this.previewTarget, this.previewSource])
    assert.ok(this.previewResult.stderr.includes(context), this.previewResult.stderr);
});
