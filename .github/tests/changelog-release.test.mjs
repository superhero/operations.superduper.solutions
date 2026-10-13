// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { addCommits, parseChangelog } from "../scripts/changelog.mjs";

const helper = new URL("../scripts/prepare-release-changelog.mjs", import.meta.url).href;
const version = "1.2.3";
const branch = `release/${version}`;
const a = "a".repeat(40), b = "b".repeat(40), fix = "c".repeat(40);
function command(world, executable, args, options = {})
{
  const result = spawnSync(executable, args, {
    cwd: world.releaseGit.root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8", timeout: 10000, ...options,
  });
  assert.ifError(result.error);
  return result;
}
function git(world, ...args)
{
  const result = command(world, "git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function write(world, path, text) { writeFileSync(join(world.releaseGit.root, path), text); }
function commit(world, message)
{
  git(world, "add", "."); git(world, "commit", "-qm", message);
  return git(world, "rev-parse", "HEAD");
}
function prepare(world, head = world.releaseGit.head)
{
  const { source, main } = world.releaseGit;
  const result = command(world, process.execPath, ["--input-type=module", "--eval",
    `import { prepareRelease } from ${JSON.stringify(helper)}; console.log(JSON.stringify(prepareRelease(JSON.parse(process.argv[1]))));`,
    JSON.stringify({ source, main, version, head })]);
  return result;
}
function prepared(world, head)
{
  const result = prepare(world, head);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function publish(world, expected, sha)
{
  return command(world, process.execPath, ["--input-type=module", "--eval",
    `import { publishRelease } from ${JSON.stringify(helper)}; publishRelease(JSON.parse(process.argv[1]));`,
    JSON.stringify({ remote: world.releaseGit.remote, branch, expected, sha })]);
}
function remoteHead(world) { return git(world, "ls-remote", world.releaseGit.remote, `refs/heads/${branch}`).split("\t")[0]; }
function addEntry(world, sha, message)
{
  const path = join(world.releaseGit.root, "CHANGELOG.md");
  writeFileSync(path, addCommits(readFileSync(path, "utf8"), [{ sha, message }], "example/repository"));
}

Given("a local release prepared from develop Staging", function ()
{
  const root = join(this.automation.root, "release-work");
  mkdirSync(root);
  this.releaseGit = { root, remote: join(this.automation.root, "remote.git") };
  git(this, "init", "-q", "--initial-branch=main");
  git(this, "config", "user.name", "Release fixture");
  git(this, "config", "user.email", "release@example.invalid");
  write(this, "CHANGELOG.md", "# Changelog\n\n## Staging\n");
  write(this, "app.txt", "initial\n");
  this.releaseGit.main = commit(this, "initial");
  git(this, "checkout", "-qb", "develop");
  write(this, "feature.txt", "first feature\n");
  addEntry(this, a, "feat: initial feature\n\nA complete commit body.");
  this.releaseGit.source = commit(this, "feat: initial feature");
  this.releaseGit.head = this.releaseGit.source;
  git(this, "init", "--bare", "-q", this.releaseGit.remote);
  git(this, "push", this.releaseGit.remote, `${this.releaseGit.source}:refs/heads/${branch}`);
  this.releaseGit.prepared = prepared(this);
  assert.equal(git(this, "show", "-s", "--format=%P", this.releaseGit.prepared.sha),
    `${this.releaseGit.source} ${this.releaseGit.main}`);
  assert.equal(publish(this, this.releaseGit.source, this.releaseGit.prepared.sha).status, 0);
  this.releaseGit.head = this.releaseGit.prepared.sha;
  this.releaseGit.expectedRemote = remoteHead(this);
});

Given("the release has its own fix and develop has another staged commit", function ()
{
  git(this, "checkout", "--detach", this.releaseGit.head);
  write(this, "release-fix.txt", "retain this release fix\n");
  addEntry(this, fix, "fix: retain a release-only correction");
  this.releaseGit.head = commit(this, "fix: release only");
  git(this, "push", this.releaseGit.remote, `${this.releaseGit.head}:refs/heads/${branch}`);
  git(this, "checkout", "develop");
  write(this, "second-feature.txt", "second feature\n");
  addEntry(this, b, "feat: second feature\n\nKeep this body too.");
  this.releaseGit.source = commit(this, "feat: second feature");
});

When("the next develop integration prepares that release", function ()
{
  this.releaseGit.prepared = prepared(this);
  const result = publish(this, this.releaseGit.head, this.releaseGit.prepared.sha);
  assert.equal(result.status, 0, result.stderr);
});
Then("the release version contains each staged commit exactly once", function ()
{
  const text = git(this, "show", `${this.releaseGit.prepared.sha}:CHANGELOG.md`);
  const document = parseChangelog(text);
  assert.deepEqual(document.releases.map(release => release.version), [version]);
  assert.deepEqual(new Set(document.releases[0].entries.map(entry => entry.sha)), new Set([a, b, fix]));
  assert.equal(document.releases[0].entries.length, 3);
  assert.equal(document.releases[0].entries.find(entry => entry.sha === b).message, "feat: second feature\n\nKeep this body too.");
});
Then("the release retains its own fix and has empty Staging", function ()
{
  const sha = this.releaseGit.prepared.sha;
  assert.equal(git(this, "show", `${sha}:release-fix.txt`), "retain this release fix");
  assert.deepEqual(parseChangelog(git(this, "show", `${sha}:CHANGELOG.md`)).staging, []);
  assert.equal(prepared(this, sha).sha, sha);
});
When("release changelog preparation is retried", function ()
{
  // An interrupted creation recomputes from the source; an existing PR retries from its prepared head.
  assert.deepEqual(prepared(this, this.releaseGit.source), this.releaseGit.prepared);
  this.releaseGit.retry = prepared(this);
  const result = publish(this, this.releaseGit.head, this.releaseGit.retry.sha);
  assert.equal(result.status, 0, result.stderr);
});
Then("the prepared release commit and remote branch do not change", function ()
{
  assert.equal(this.releaseGit.retry.sha, this.releaseGit.head);
  assert.equal(remoteHead(this), this.releaseGit.expectedRemote);
});

Given("release and develop have conflicting application changes", function ()
{
  git(this, "checkout", "--detach", this.releaseGit.head);
  write(this, "app.txt", "release fix\n");
  this.releaseGit.head = commit(this, "fix: conflicting release change");
  git(this, "push", this.releaseGit.remote, `${this.releaseGit.head}:refs/heads/${branch}`);
  git(this, "checkout", "develop");
  write(this, "app.txt", "develop change\n");
  this.releaseGit.source = commit(this, "feat: conflicting develop change");
  this.releaseGit.expectedRemote = remoteHead(this);
});
When("the next develop integration is refused", function ()
{
  const result = prepare(this);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicts outside CHANGELOG\.md/);
});
When("the release branch advances before publication", function ()
{
  this.releaseGit.prepared = prepared(this);
  git(this, "checkout", "--detach", this.releaseGit.head);
  write(this, "concurrent-fix.txt", "another writer\n");
  const advanced = commit(this, "fix: another release writer");
  git(this, "push", this.releaseGit.remote, `${advanced}:refs/heads/${branch}`);
  this.releaseGit.expectedRemote = advanced;
});
Then("publishing the prepared release refuses the stale expected head", function ()
{
  const result = publish(this, this.releaseGit.head, this.releaseGit.prepared.sha);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stale info/);
  const retry = publish(this, this.releaseGit.head, this.releaseGit.head);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /stale info/);
});
Then("the release remote branch does not change", function ()
{
  assert.equal(remoteHead(this), this.releaseGit.expectedRemote);
});
When("publication would replace it with an unrelated prepared history", function ()
{
  const result = publish(this, this.releaseGit.head, this.releaseGit.main);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /merge-base failed/);
});
When("only the initialized baseline is compared for release eligibility", function ()
{
  this.releaseGit.source = this.releaseGit.main;
  this.releaseGit.eligibility = prepared(this, this.releaseGit.main);
});
Then("changelog preparation reports no substantive release changes", function ()
{
  assert.equal(this.releaseGit.eligibility.substantive_changes, false);
});
