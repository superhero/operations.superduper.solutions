// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";

function git(world, ...args)
{
  const result = spawnSync("git", args, {
    cwd: world.automation.root, env: { ...process.env, ...world.automation.env }, encoding: "utf8"
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function file(world, path, content = "# Documentation\n")
{
  const absolute = join(world.automation.root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  git(world, "add", "--", path);
}

function initialize(world)
{
  git(world, "init", "-q", "--initial-branch=main");
  git(world, "config", "user.name", "Documentation test");
  git(world, "config", "user.email", "documentation@example.invalid");
  git(world, "config", "commit.gpgsign", "false");
  git(world, "config", "core.filemode", "true");
}

function checkoutState(world)
{
  return {
    head: git(world, "rev-parse", "HEAD"),
    branch: git(world, "symbolic-ref", "HEAD"),
    branches: git(world, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"),
    status: git(world, "status", "--porcelain", "--untracked-files=no"),
    unstaged: git(world, "diff", "--binary"),
    staged: git(world, "diff", "--cached", "--binary")
  };
}

function checkValidation(result, args, outcome, reason)
{
  assert.equal(result.status === 0, outcome === "accepted", result.stdout + result.stderr);
  if (outcome === "rejected")
    for (const context of [reason, ...args.slice(0, 2)])
      assert.ok(result.stderr.includes(context), result.stderr);
  else assert.match(result.stdout, /^Validated [1-9][0-9]* Markdown document changes\./);
}

Given("a documentation branch contains {string}", function (change)
{
  initialize(this);
  for (const path of ["README.md", "docs/remove.md", "docs/old.md", "application.ts"]) file(this, path);
  if (change.includes("executable") && change !== "executable Markdown")
  {
    chmodSync(join(this.automation.root, "README.md"), 0o755);
    git(this, "add", "README.md");
  }
  if (change === "a replaced Markdown symlink")
  {
    unlinkSync(join(this.automation.root, "README.md"));
    symlinkSync("application.ts", join(this.automation.root, "README.md"));
    git(this, "add", "README.md");
  }
  git(this, "commit", "-qm", "Initial files");
  this.documentationBase = git(this, "rev-parse", "HEAD");
  git(this, "checkout", "-qb", "docs/example");
  switch (change)
  {
    case "a Markdown addition": file(this, "docs/NEW.MD"); break;
    case "a Markdown edit": file(this, "README.md", "# Updated documentation\n"); break;
    case "a Markdown deletion": git(this, "rm", "-q", "docs/remove.md"); break;
    case "a Markdown rename": git(this, "mv", "docs/old.md", "docs/new.md"); break;
    case "unusual Markdown filenames":
      for (const path of ["docs/two words.md", "docs/tab\tname.md", "docs/line\nbreak.md", "-leading.md", "$(touch executed).md"])
        file(this, path);
      break;
    case "more than 300 Markdown files":
    case "code after 300 Markdown files":
      mkdirSync(join(this.automation.root, "many"));
      for (let index = 0; index < 350; index++) writeFileSync(join(this.automation.root, `many/${index}.md`), "# Documentation\n");
      git(this, "add", "many");
      if (change === "code after 300 Markdown files") file(this, "zz-hidden-code.js");
      break;
    case "documentation behind an updated base":
      git(this, "checkout", "-q", "main");
      file(this, "application.ts", "base-only code change\n");
      git(this, "commit", "-qm", "Update base code");
      this.documentationBase = git(this, "rev-parse", "HEAD");
      git(this, "checkout", "-q", "docs/example");
      file(this, "README.md", "# Updated documentation\n");
      break;
    case "code beside documentation":
      file(this, "README.md", "# Updated documentation\n");
      file(this, ".github/workflows/documentation.yml");
      break;
    case "code renamed to Markdown": git(this, "mv", "application.ts", "guide.md"); break;
    case "Markdown renamed to code": git(this, "mv", "README.md", "guide.ts"); break;
    case "executable Markdown":
    case "formerly executable Markdown":
      chmodSync(join(this.automation.root, "README.md"), change === "executable Markdown" ? 0o755 : 0o644);
      git(this, "add", "README.md");
      break;
    case "deleted executable Markdown": git(this, "rm", "-q", "README.md"); break;
    case "a Markdown symlink":
      symlinkSync("application.ts", join(this.automation.root, "linked.md"));
      git(this, "add", "linked.md");
      break;
    case "a replaced Markdown symlink":
      unlinkSync(join(this.automation.root, "README.md"));
      file(this, "README.md");
      break;
    case "a Markdown gitlink":
      git(this, "update-index", "--add", "--cacheinfo", `160000,${this.documentationBase},module.md`);
      mkdirSync(join(this.automation.root, "module.md"));
      break;
    case "an empty commit": break;
    default: assert.fail(`Unknown documentation change: ${change}`);
  }
  git(this, "commit", "--allow-empty", "-qm", "Documentation candidate");
  this.documentationHead = git(this, "rev-parse", "HEAD");
  this.documentationArguments = [this.documentationBase, this.documentationHead];
  this.documentationStatus = git(this, "status", "--porcelain", "--untracked-files=no");
});

Given("its documentation comparison has {string}", function (problem)
{
  const tree = git(this, "rev-parse", `${this.documentationHead}^{tree}`);
  switch (problem)
  {
    case "a short SHA": this.documentationArguments[0] = this.documentationBase.slice(0, 8); break;
    case "an extra argument": this.documentationArguments.push("unexpected"); break;
    case "an unavailable base": this.documentationArguments[0] = "f".repeat(40); break;
    case "an unavailable head": this.documentationArguments[1] = "f".repeat(40); break;
    case "a blob instead of a commit": this.documentationArguments[1] = git(this, "rev-parse", "HEAD:README.md"); break;
    case "unrelated histories":
      this.documentationArguments[1] = git(this, "commit-tree", tree, "-m", "Unrelated root");
      break;
    case "ambiguous merge bases":
    {
      const left = git(this, "commit-tree", tree, "-p", this.documentationBase, "-m", "Left ancestor");
      const right = git(this, "commit-tree", tree, "-p", this.documentationBase, "-m", "Right ancestor");
      this.documentationArguments = [
        git(this, "commit-tree", tree, "-p", left, "-p", right, "-m", "Left merge"),
        git(this, "commit-tree", tree, "-p", right, "-p", left, "-m", "Right merge")
      ];
      break;
    }
    case "an unavailable tree":
      // Lose only the candidate's tree; commit lookup and merge-base still work.
      renameSync(join(this.automation.root, ".git/objects", tree.slice(0, 2), tree.slice(2)), join(this.automation.root, "saved-tree"));
      this.documentationMissingTree = tree;
      break;
    default: assert.fail(`Unknown documentation history problem: ${problem}`);
  }
});

When("its documentation changes are validated", function ()
{
  this.documentationResult = this.automation.execute("validate-documentation-changes.sh",
    this.documentationArguments, [], { success: null });
  if (this.documentationMissingTree)
  {
    const tree = this.documentationMissingTree;
    renameSync(join(this.automation.root, "saved-tree"), join(this.automation.root, ".git/objects", tree.slice(0, 2), tree.slice(2)));
  }
});

Then("documentation validation is {string} with {string} and preserves the checkout", function (outcome, reason)
{
  checkValidation(this.documentationResult, this.documentationArguments, outcome, reason);
  assert.equal(git(this, "rev-parse", "HEAD"), this.documentationHead);
  assert.equal(git(this, "status", "--porcelain", "--untracked-files=no"), this.documentationStatus);
  assert.equal(existsSync(join(this.automation.root, "executed")), false);
  assert.deepEqual(this.automation.calls(), []);
});

Given("a reusable documentation branch has {string}", function (history)
{
  initialize(this);
  file(this, "README.md", "# Initial documentation\n");
  file(this, "application.ts", "initial code\n");
  git(this, "commit", "-qm", "Shared starting point");
  const shared = git(this, "rev-parse", "HEAD");
  this.documentationTargets = ["main", "develop", "release/1.2.3"];
  for (const target of this.documentationTargets)
  {
    git(this, "checkout", "-qB", target, shared);
    file(this, "application.ts", `${target} code\n`);
    git(this, "commit", "-qm", `Code for ${target}`);
  }
  git(this, "checkout", "-qb", "docs/reused", history === "a develop base" ? "develop" : shared);
  file(this, "README.md", "# First documentation edit\n");
  git(this, "commit", "-qm", "First documentation edit");
  if (history === "a develop refresh")
    git(this, "merge", "--no-edit", "develop");
  else assert.ok(["shared ancestry", "a develop base"].includes(history), history);
  this.documentationHead = git(this, "rev-parse", "HEAD");
});

Given("its first documentation change was squashed into {string}", function (target)
{
  assert.ok(this.documentationTargets.includes(target), target);
  git(this, "checkout", "-q", target);
  git(this, "merge", "--squash", "docs/reused");
  git(this, "commit", "-qm", "Squash first documentation edit");
  git(this, "checkout", "-q", "docs/reused");
  assert.equal(git(this, "rev-parse", "HEAD"), this.documentationHead);
});

Given("the original documentation branch receives another Markdown edit", function ()
{
  file(this, "README.md", "# Second documentation edit\n");
  git(this, "commit", "-qm", "Second documentation edit");
  this.documentationHead = git(this, "rev-parse", "HEAD");
  assert.equal(git(this, "show", "HEAD:application.ts"), "initial code");
});

When("the same documentation head is validated against each integration target", function ()
{
  // Local edits must not affect the committed diff or be overwritten by validation.
  file(this, "README.md", "# Staged local edit\n");
  writeFileSync(join(this.automation.root, "README.md"), "# Unstaged local edit\n");
  const original = checkoutState(this);
  this.documentationTargetResults = this.documentationTargets.map(target => {
    const args = [git(this, "rev-parse", target), this.documentationHead];
    const result = this.automation.execute("validate-documentation-changes.sh", args, [], { success: null });
    return { target, args, result, original, after: checkoutState(this) };
  });
});

Then("documentation validation for each target preserves the repository and is", function (table)
{
  assert.deepEqual(this.documentationTargetResults.map(({ target }) => target), table.hashes().map(row => row.target));
  for (const [index, { outcome }] of table.hashes().entries())
  {
    const { args, result, original, after } = this.documentationTargetResults[index];
    checkValidation(result, args, outcome, "Only Markdown");
    assert.deepEqual(after, original);
  }
  assert.deepEqual(this.automation.calls(), []);
});
