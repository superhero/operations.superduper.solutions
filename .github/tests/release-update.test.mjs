// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "yaml";
import { addCommits, mergeChangelogs, releaseChangelog } from "../scripts/changelog.mjs";
import "./support.mjs";

const changelogChanges = new Set([
  "an exact release changelog fold", "a legacy release changelog fold", "a release changelog for another version",
  "a partial release changelog fold", "a noncanonical release changelog fold", "a release changelog rewriting old messages", "a release changelog beside other Markdown",
  "an empty release changelog fold", "normalization of an existing release version", "a release changelog normalization", "authored release changelog notes",
]);

function git(world, ...args)
{
  const result = spawnSync("git", args, {
    cwd: world.automation.root, env: { ...process.env, ...world.automation.env }, encoding: "utf8"
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function file(world, path, contents = "# Documentation\n")
{
  const absolute = join(world.automation.root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  git(world, "add", "--", path);
}

function commit(world, message)
{
  git(world, "commit", "--allow-empty", "-qm", message);
  return git(world, "rev-parse", "HEAD");
}

function hideObject(world, object)
{
  const source = join(world.automation.root, ".git/objects", object.slice(0, 2), object.slice(2));
  const destination = join(world.automation.root, `saved-object-${world.releaseUpdate.missing.length}`);
  renameSync(source, destination);
  world.releaseUpdate.missing.push({ source, destination });
}

Given("a release synchronization contains {string}", function (change)
{
  git(this, "init", "-q", "--initial-branch=main");
  git(this, "config", "user.name", "Release routing test");
  git(this, "config", "user.email", "release-routing@example.invalid");
  git(this, "config", "commit.gpgsign", "false");
  git(this, "config", "core.filemode", "true");
  for (const path of ["README.md", "docs/remove.md", "docs/old.md", "application.ts"]) file(this, path);
  const history = releaseChangelog(addCommits("", [{ sha: "a".repeat(40), message: "Historical message" }]),
    change === "normalization of an existing release version" ? "1.2.3" : "1.1.0");
  const pending = [
    { sha: "b".repeat(40), message: "feat: preserve $(touch executed) as literal text\n\nFull source rationale.\n" },
    { sha: "c".repeat(40), message: "fix: include the complete pending set\n" },
  ];
  let changelog = ["an empty release changelog fold", "a release changelog normalization", "normalization of an existing release version"].includes(change)
    ? history : addCommits(history, pending);
  if (["a legacy release changelog fold", "a release changelog normalization", "normalization of an existing release version"].includes(change))
    changelog = changelog.replace("## Latest", "## Staging").replace("<!-- changelog-latest-end -->", "<!-- changelog-staging-end -->");
  if (changelogChanges.has(change)) file(this, "CHANGELOG.md", changelog);
  if (["formerly executable Markdown", "deleted executable Markdown"].includes(change))
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
  const trusted = commit(this, "Trusted release base");
  let before = trusted;
  git(this, "checkout", "-qb", "release/1.2.3");
  switch (change)
  {
    case "an exact release changelog fold":
    case "a legacy release changelog fold":
    case "an empty release changelog fold":
    case "normalization of an existing release version":
      file(this, "CHANGELOG.md", releaseChangelog(changelog, "1.2.3")); break;
    case "a release changelog for another version":
      file(this, "CHANGELOG.md", releaseChangelog(changelog, "1.2.4")); break;
    case "a partial release changelog fold":
      file(this, "CHANGELOG.md", releaseChangelog(addCommits(history, pending.slice(0, 1)), "1.2.3")); break;
    case "a noncanonical release changelog fold":
      file(this, "CHANGELOG.md", `${releaseChangelog(changelog, "1.2.3")}\n`); break;
    case "a release changelog rewriting old messages":
      file(this, "CHANGELOG.md", releaseChangelog(changelog, "1.2.3").replace("Historical message", "Altered historical message")); break;
    case "a release changelog beside other Markdown":
      file(this, "CHANGELOG.md", releaseChangelog(changelog, "1.2.3"));
      file(this, "README.md", "# Updated documentation\n");
      break;
    case "a release changelog normalization": file(this, "CHANGELOG.md", mergeChangelogs(changelog)); break;
    case "authored release changelog notes": file(this, "CHANGELOG.md", `${changelog}\nHandwritten release notes.\n`); break;
    case "a Markdown edit": file(this, "README.md", "# Updated documentation\n"); break;
    case "a Markdown addition": file(this, "docs/NEW.MD"); break;
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
    case "a forward documentation merge":
      git(this, "checkout", "-qb", "docs/example");
      file(this, "README.md", "# Merged documentation\n");
      commit(this, "Documentation branch");
      git(this, "checkout", "-q", "release/1.2.3");
      git(this, "merge", "--no-ff", "--no-edit", "docs/example");
      break;
    case "application code": file(this, "application.ts", "export const updated = true;\n"); break;
    case "code beside documentation":
      file(this, "README.md", "# Updated documentation\n");
      file(this, ".github/workflows/untrusted.yml", "name: Untrusted code\n");
      break;
    case "a code deletion": git(this, "rm", "-q", "application.ts"); break;
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
      git(this, "update-index", "--add", "--cacheinfo", `160000,${trusted},module.md`);
      mkdirSync(join(this.automation.root, "module.md"));
      break;
    case "a documentation rewind":
    case "rewritten documentation history":
    case "removed application history":
      file(this, change === "removed application history" ? "application.ts" : "README.md", "Previous release update\n");
      before = commit(this, "Previous release update");
      git(this, "reset", "--hard", trusted);
      if (change !== "a documentation rewind") file(this, "docs/updated.md");
      break;
    case "unrelated documentation history":
    case "an empty commit":
    case "an unchanged head": break;
    default: assert.fail(`Unknown release update: ${change}`);
  }
  let head = change === "an unchanged head" || change === "a documentation rewind"
    ? git(this, "rev-parse", "HEAD") : commit(this, "Release update");
  if (change === "unrelated documentation history")
    head = git(this, "commit-tree", git(this, "rev-parse", "HEAD^{tree}"), "-m", "Unrelated root");
  git(this, "checkout", "-q", "main");
  this.releaseUpdate = {
    args: ["synchronize", "release/1.2.3", before, head], before, head, trusted, missing: [],
    status: git(this, "status", "--porcelain", "--untracked-files=no")
  };
});

Given("its release update has {string}", function (problem)
{
  const update = this.releaseUpdate;
  switch (problem)
  {
    case "a missing previous SHA": update.args[2] = ""; break;
    case "a short previous SHA": update.args[2] = update.before.slice(0, 8); break;
    case "a short head SHA": update.args[3] = update.head.slice(0, 8); break;
    case "an invalid head SHA": update.args[3] = "$(touch executed)"; break;
    case "an invalid source branch": update.args[1] = "release/../invalid"; break;
    case "an unsupported event": update.args[0] = "closed"; break;
    case "an extra argument": update.args.push("unexpected"); break;
    case "an unavailable previous head": update.args[2] = "f".repeat(40); break;
    case "an unavailable head": update.args[3] = "f".repeat(40); break;
    case "a non-commit previous head": update.args[2] = git(this, "rev-parse", "HEAD:README.md"); break;
    case "a non-commit head": update.args[3] = git(this, "rev-parse", "HEAD^{tree}"); break;
    case "an unavailable before tree": hideObject(this, git(this, "rev-parse", `${update.before}^{tree}`)); break;
    case "an unavailable head tree": hideObject(this, git(this, "rev-parse", `${update.head}^{tree}`)); break;
    case "an unavailable nested tree":
    {
      git(this, "checkout", "-q", "release/1.2.3");
      file(this, "docs/extra.md");
      update.head = update.args[3] = commit(this, "Update a nested tree");
      git(this, "checkout", "-q", "main");
      hideObject(this, git(this, "rev-parse", `${update.head}:docs`));
      break;
    }
    case "an unavailable changed blob": hideObject(this, git(this, "rev-parse", `${update.head}:README.md`)); break;
    case "an unavailable ancestor":
    {
      const intermediate = update.head;
      update.head = update.args[3] = git(this, "commit-tree", git(this, "rev-parse", `${intermediate}^{tree}`),
        "-p", intermediate, "-m", "New head");
      hideObject(this, intermediate);
      break;
    }
    default: assert.fail(`Unknown release routing problem: ${problem}`);
  }
});

Given("its release event is {string} on {string} without a previous head", function (action, branch)
{
  this.releaseUpdate.args = [action, branch, "", this.releaseUpdate.head];
});

When("the release update is classified", function ()
{
  this.releaseUpdate.result = this.automation.execute("classify-release-update.sh",
    this.releaseUpdate.args, [], { success: null });
  for (const { source, destination } of this.releaseUpdate.missing) renameSync(destination, source);
});

Then("the release pipeline is {string} without changing the trusted checkout", function (route)
{
  const { result, trusted, status } = this.releaseUpdate;
  const diagnostics = result.stdout + result.stderr;
  assert.equal(result.status === 0, route !== "blocked", diagnostics);
  assert.equal(readFileSync(this.automation.output, "utf8"),
    route === "blocked" ? "" : `run_release=${route === "full"}\n`, diagnostics);
  if (route === "blocked") assert.match(result.stderr, /::error::/);
  assert.equal(git(this, "rev-parse", "HEAD"), trusted);
  assert.equal(git(this, "status", "--porcelain", "--untracked-files=no"), status);
  assert.equal(existsSync(join(this.automation.root, "executed")), false);
  assert.deepEqual(this.automation.calls(), []);
});

Given("its pinned release objects cannot be fetched", function ()
{
  git(this, "remote", "add", "origin", join(this.automation.root, "missing-remote"));
  // An already-present object can let Git complete a fetch without contacting
  // the remote; require a missing pinned object to exercise the failure path.
  this.releaseUpdate.fetchHead = "f".repeat(40);
});

Given("its trusted release classifier is available", function ()
{
  for (const name of ["classify-release-update.sh", "check-release-changelog-update.mjs", "changelog.mjs"])
  {
    const path = join(this.automation.root, ".github/scripts", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, readFileSync(new URL(`../scripts/${name}`, import.meta.url)));
  }
});

Given("its trusted classifier predates release changelog routing", function ()
{
  const path = join(this.automation.root, ".github/scripts/classify-release-update.sh");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/usr/bin/env bash\ntouch executed\nprintf "run_release=false\\n" >> "$GITHUB_OUTPUT"\n');
});

Given("its trusted release checker lacks its changelog module", function ()
{
  unlinkSync(join(this.automation.root, ".github/scripts/changelog.mjs"));
});

Given("only the proposed release contains a classifier", function ()
{
  git(this, "checkout", "-q", "release/1.2.3");
  file(this, ".github/scripts/classify-release-update.sh",
    '#!/usr/bin/env bash\ntouch executed\nprintf "run_release=false\\n" >> "$GITHUB_OUTPUT"\n');
  this.releaseUpdate.head = commit(this, "Add proposed classifier");
  this.releaseUpdate.args[3] = this.releaseUpdate.head;
  git(this, "checkout", "-q", "main");
  assert.equal(existsSync(join(this.automation.root, ".github/scripts/classify-release-update.sh")), false);
});

When("the release routing workflow steps execute", function ()
{
  const workflow = parse(readFileSync(new URL("../workflows/ci-main.yml", import.meta.url), "utf8"));
  const [action, branch, before, head] = this.releaseUpdate.args;
  const steps = workflow.jobs["release-route"].steps;
  const run = (name) => {
    const step = steps.find((candidate) => candidate.name === name);
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: this.automation.root,
      env: {
        ...process.env, ...this.automation.env, GITHUB_SERVER_URL: "https://github.com",
        EVENT_ACTION: action, HEAD_BRANCH: branch, BEFORE_SHA: before, HEAD_SHA: head
      },
      encoding: "utf8", timeout: 10000
    });
    assert.ifError(result.error);
    return result;
  };
  if (action === "synchronize" && branch.startsWith("release/"))
  {
    this.releaseUpdate.result = run("Fetch pinned release update objects");
    if (this.releaseUpdate.result.status !== 0) return;
  }
  this.releaseUpdate.result = run("Classify release update");
});

When("the release update objects are fetched", function ()
{
  const workflow = parse(readFileSync(new URL("../workflows/ci-main.yml", import.meta.url), "utf8"));
  const step = workflow.jobs["release-route"].steps.find(({ name }) => name === "Fetch pinned release update objects");
  this.releaseUpdate.fetch = spawnSync("bash", ["-c", step.run], {
    cwd: this.automation.root,
    env: {
      ...process.env, ...this.automation.env, GITHUB_SERVER_URL: "https://github.com",
      BEFORE_SHA: this.releaseUpdate.before, HEAD_SHA: this.releaseUpdate.fetchHead
    },
    encoding: "utf8", timeout: 10000
  });
});

Then("release update routing stops before classification", function ()
{
  const result = this.releaseUpdate.fetch;
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(this.automation.output, "utf8"), "");
  assert.deepEqual(this.automation.calls(), []);
});
