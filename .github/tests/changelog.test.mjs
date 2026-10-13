// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { addCommits, mergeChangelogs, parseChangelog, releaseChangelog } from "../scripts/changelog.mjs";
import { REPOSITORY } from "./support.mjs";

const STAGING_END = "<!-- changelog-staging-end -->";
const EMPTY = `# Changelog\n\n## Staging\n\n${STAGING_END}\n`;
const commit = (id, message = `Change ${id}`) => ({ sha: id.repeat(40), message });
const stage = (text, ...ids) => addCommits(text, ids.map(id => commit(id)), REPOSITORY);
const allEntries = document => [...document.staging, ...document.releases.flatMap(release => release.entries)];

function captureFailure(world, operation)
{
  assert.throws(operation, error =>
  {
    world.changelogError = error.message;
    return true;
  });
}

Given("a changelog commit with a {string} message", function (kind)
{
  this.changelogSideEffect = join(this.automation.root, "message-executed");
  const messages = {
    "subject only": "feat: show the new operation",
    "subject and body": "fix: preserve failed runs\n\nKeep the full failure context.\n\nReviewed-by: A Developer",
    "Markdown and long fences": `docs: examples <script>alert(1)</script>\n\n## 9.9.9\n\`\`\`sh\nprintf hi\n\`\`\`\n\`\`\`\`\`\`\n~~~\n<!-- changelog-commit:${"b".repeat(40)} -->\n[open](javascript:alert(1))`,
    "shell substitutions": `fix: keep $(touch '${this.changelogSideEffect}') literal\n\n\`touch '${this.changelogSideEffect}'\`\n$HOME; echo unsafe > '${this.changelogSideEffect}'`,
    "trailing newlines": "feat: retain terminators\n\nBody ends here.\n\n",
    "indentation and Unicode": "feat: résumé and 日本語\n\n  keep two spaces\n\tkeep a tab\n \nlast line  ",
  };
  assert.ok(Object.hasOwn(messages, kind));
  this.changelogCommit = commit("a", messages[kind]);
});

When("that commit is staged and released as {string}", function (version)
{
  this.changelogText = addCommits("", [this.changelogCommit], REPOSITORY);
  assert.equal(parseChangelog(this.changelogText).staging[0].message, this.changelogCommit.message);
  this.changelogText = releaseChangelog(mergeChangelogs(this.changelogText, this.changelogText), version);
});

Then("the complete changelog message survives unchanged", function ()
{
  const document = parseChangelog(this.changelogText);
  assert.deepEqual(document.staging, []);
  assert.equal(document.releases[0].entries[0].message, this.changelogCommit.message);
  assert.ok(this.changelogText.includes(this.changelogCommit.message));
});

Then("the changelog includes a link to the full commit SHA", function ()
{
  assert.ok(this.changelogText.includes(`https://github.com/${REPOSITORY}/commit/${this.changelogCommit.sha}`));
  assert.ok(this.changelogText.includes(`<!-- changelog-commit:${this.changelogCommit.sha} -->`));
});

Then("changelog message text has no executable side effects", function ()
{
  assert.equal(existsSync(this.changelogSideEffect), false);
});

Given("a changelog commit already {string}", function (placement)
{
  this.changelogText = stage("", "a");
  if (placement === "released") this.changelogText = releaseChangelog(this.changelogText, "1.0.0");
});

When("the same changelog commit is added twice alongside a new commit", function ()
{
  this.changelogText = stage(this.changelogText, "a", "a", "b");
  assert.equal(stage(this.changelogText, "a", "a", "b"), this.changelogText);
});

Then("each full commit SHA appears exactly once in the changelog", function ()
{
  assert.deepEqual(allEntries(parseChangelog(this.changelogText)).map(entry => entry.sha).sort(),
    ["a".repeat(40), "b".repeat(40)]);
});

Then("the original changelog commit remains {string}", function (placement)
{
  const document = parseChangelog(this.changelogText);
  const entries = placement === "staged" ? document.staging : document.releases[0].entries;
  assert.ok(entries.some(entry => entry.sha === "a".repeat(40)));
});

Then("the new changelog commit remains in Staging", function ()
{
  assert.ok(parseChangelog(this.changelogText).staging.some(entry => entry.sha === "b".repeat(40)));
});

Given("two changelog commits have identical messages and different full SHAs", function ()
{
  this.changelogCommits = [commit("a", "fix: identical subject"), commit("b", "fix: identical subject")];
});

When("those changelog commits are staged", function ()
{
  this.changelogText = addCommits("", this.changelogCommits);
});

Then("both distinct commit identities remain in Staging", function ()
{
  assert.deepEqual(parseChangelog(this.changelogText).staging, this.changelogCommits);
});

Given("the changelog is ready for {string}", function (operation)
{
  this.changelogText = stage("", "a");
  if (operation === "the first release") return;
  this.changelogText = stage(releaseChangelog(this.changelogText, "1.0.0"), "b");
  if (operation === "the next release") return;
  const version = operation === "numeric version sorting" ? "1.9.0" : "1.1.0";
  this.changelogText = stage(releaseChangelog(this.changelogText, version), "c");
});

When("the changelog is released as {string}", function (version)
{
  this.changelogVersion = version;
  this.changelogText = releaseChangelog(this.changelogText, version);
});

Then("Staging is the first changelog section and is empty", function ()
{
  assert.ok(this.changelogText.startsWith(`${EMPTY}\n## `));
  assert.deepEqual(parseChangelog(this.changelogText).staging, []);
});

Then("the changelog release sections contain {string}", function (sections)
{
  const expected = sections.split(";").map(section =>
  {
    const [version, ids] = section.split(":");
    return { version, entries: ids.split(",").map(id => ({ ...commit(id), repository: REPOSITORY })) };
  });
  assert.deepEqual(parseChangelog(this.changelogText).releases, expected);
});

Then("preparing that changelog release again makes no change", function ()
{
  assert.equal(releaseChangelog(this.changelogText, this.changelogVersion), this.changelogText);
});

Given("release and development changelogs share a released commit", function ()
{
  const oldRelease = releaseChangelog(stage("", "a"), "1.0.0");
  this.changelogRelease = releaseChangelog(stage(oldRelease, "b"), "1.1.0");
  this.changelogDevelopment = stage(oldRelease, "b", "c");
});

When("the changelogs are merged with {string} first", function (first)
{
  this.changelogText = first === "release" ? mergeChangelogs(this.changelogRelease, this.changelogDevelopment) :
    mergeChangelogs(this.changelogDevelopment, this.changelogRelease);
});

Then("the released commit occurs only under its original version", function ()
{
  const document = parseChangelog(this.changelogText);
  assert.deepEqual(document.releases.map(release => [release.version, release.entries.map(entry => entry.sha)]),
    [["1.1.0", ["b".repeat(40)]], ["1.0.0", ["a".repeat(40)]]]);
  assert.equal(allEntries(document).filter(entry => entry.sha === "b".repeat(40)).length, 1);
});

Then("new development work remains in Staging", function ()
{
  assert.deepEqual(parseChangelog(this.changelogText).staging, [{ ...commit("c"), repository: REPOSITORY }]);
});

Then("merging the resulting changelog again makes no change", function ()
{
  assert.equal(mergeChangelogs(this.changelogText, this.changelogRelease, this.changelogDevelopment), this.changelogText);
});

Given("the initial changelog text is {string}", function (initial)
{
  this.changelogText = initial === "absent" ? "" : initial === "legacy empty Staging" ? "# Changelog\n\n## Staging\n" : EMPTY;
});

When("the changelog is merged without new commits", function ()
{
  this.changelogText = mergeChangelogs(this.changelogText);
});

Then("the changelog contains only its title and empty Staging section", function ()
{
  assert.equal(this.changelogText, EMPTY);
});

Given("changelog content contains {string}", function (problem)
{
  const valid = stage("", "a");
  const entry = valid.slice(valid.indexOf("<!-- changelog-commit:"), valid.indexOf(STAGING_END)).trim();
  const cases = {
    "an unrelated title": "# Release notes\n\n## Staging\n",
    "a missing Staging section": "# Changelog\n\n## 1.0.0\n",
    "authored prose": `${valid}\nDo not discard this manually written explanation.\n`,
    "an unknown section": `${valid}\n## Notes\n`,
    "duplicate versions": `${valid}\n## 1.0.0\n\n## 1.0.0\n`,
    "a repeated commit ID": valid.replace(STAGING_END, `${entry}\n\n${STAGING_END}`),
    "a missing closing fence": valid.slice(0, valid.lastIndexOf("```")),
    "a shortened commit ID": valid.replace(`changelog-commit:${"a".repeat(40)}`, "changelog-commit:aaaaaaa"),
    "a mismatched heading": valid.replace("### Commit [`aaaaaaa`]", "### Commit [`bbbbbbb`]"),
    "an unsafe message fence": valid.replace("Change a", "Change a\n````"),
    "a prefixed version": `${valid}\n## v1.0.0\n`,
    "a missing Staging boundary": valid.replace(STAGING_END, ""),
    "a repeated Staging boundary": `${valid}\n${STAGING_END}\n`,
    "an entry past Staging": `${valid}\n${entry}\n`,
  };
  assert.ok(Object.hasOwn(cases, problem));
  this.changelogText = cases[problem];
  this.changelogOriginal = this.changelogText;
});

When("that changelog is updated", function ()
{
  captureFailure(this, () => { this.changelogText = stage(this.changelogText, "b"); });
});

Then("changelog validation refuses it with {string}", function (reason)
{
  assert.ok(this.changelogError?.includes(reason), this.changelogError);
});

Then("the rejected changelog input remains unchanged", function ()
{
  assert.equal(this.changelogText, this.changelogOriginal);
});

Given("changelog histories disagree about {string}", function (conflict)
{
  this.changelogLeft = stage("", "a");
  switch (conflict)
  {
    case "commit messages": this.changelogRight = addCommits("", [commit("a", "A contradictory message")]); break;
    case "commit repositories": this.changelogRight = addCommits("", [commit("a")], "another/repository"); break;
    case "released versions":
      this.changelogRight = releaseChangelog(this.changelogLeft, "2.0.0");
      this.changelogLeft = releaseChangelog(this.changelogLeft, "1.0.0");
      break;
    default: assert.fail(`Unknown changelog conflict: ${conflict}`);
  }
});

When("those conflicting changelog histories are merged", function ()
{
  captureFailure(this, () => mergeChangelogs(this.changelogLeft, this.changelogRight));
});

When("an invalid changelog release version {string} is requested", function (version)
{
  captureFailure(this, () => releaseChangelog(this.changelogText, version));
});

Given("a changelog commit record has {string}", function (problem)
{
  this.changelogCommit = commit("a");
  this.changelogRepository = REPOSITORY;
  switch (problem)
  {
    case "a short SHA": this.changelogCommit.sha = "abcdef0"; break;
    case "an empty message": this.changelogCommit.message = "\n"; break;
    case "a NUL message": this.changelogCommit.message = "fix: unsafe\0record"; break;
    case "an unsafe slug": this.changelogRepository = "owner/repo)<script>"; break;
    default: assert.fail(`Unknown invalid changelog record: ${problem}`);
  }
});

When("that invalid changelog commit is added", function ()
{
  captureFailure(this, () => addCommits("", [this.changelogCommit], this.changelogRepository));
});

function changelogGit(world, args, allowed = [0])
{
  const result = spawnSync("git", ["-c", "user.name=Changelog Test", "-c", "user.email=changelog@example.invalid",
    "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args],
  { cwd: world.changelogGitRoot, encoding: "utf8" });
  assert.ifError(result.error);
  assert.ok(allowed.includes(result.status), result.stdout + result.stderr);
  return result;
}

function commitChangelog(world, text)
{
  writeFileSync(join(world.changelogGitRoot, "CHANGELOG.md"), text);
  changelogGit(world, ["add", "CHANGELOG.md"]);
  changelogGit(world, ["commit", "--allow-empty", "-qm", "Record changelog state"]);
  return changelogGit(world, ["rev-parse", "HEAD"]).stdout.trim();
}

Given("a Git changelog history with {string}", function (history)
{
  this.changelogGitRoot = join(this.automation.root, "git-history");
  mkdirSync(this.changelogGitRoot);
  changelogGit(this, ["init", "-q", "-b", "base"]);
  this.changelogHasPriorRelease = history === "prior releases";
  this.changelogSharedId = this.changelogHasPriorRelease ? "b" : "a";
  this.changelogReleaseVersion = this.changelogHasPriorRelease ? "1.1.0" : "1.0.0";
  const previous = this.changelogHasPriorRelease ? releaseChangelog(stage("", "a"), "1.0.0") : "";
  this.changelogSharedText = stage(previous, this.changelogSharedId);
  this.changelogGitBase = commitChangelog(this, this.changelogSharedText);
  changelogGit(this, ["switch", "-qc", "release"]);
  this.changelogRelease = releaseChangelog(this.changelogSharedText, this.changelogReleaseVersion);
  commitChangelog(this, this.changelogRelease);
});

When("a release is merged into development with {string}", function (advance)
{
  this.changelogNewIds = advance === "no new commits" ? [] : advance === "several new commits" ? ["c", "d"] : ["c"];
  changelogGit(this, ["switch", "-qc", "development", this.changelogGitBase]);
  this.changelogDevelopment = stage(this.changelogSharedText, ...this.changelogNewIds);
  commitChangelog(this, this.changelogDevelopment);
  this.changelogGitMerge = changelogGit(this, ["merge-tree", "--write-tree", "development", "release"], [0, 1]);
  const tree = this.changelogGitMerge.stdout.split("\n")[0];
  this.changelogGitMergedText = changelogGit(this, ["show", `${tree}:CHANGELOG.md`]).stdout;
});

function assertReleaseAssignments(world, text)
{
  const document = parseChangelog(text);
  assert.deepEqual(document.staging.map(entry => entry.sha), world.changelogNewIds.map(id => id.repeat(40)));
  const releases = [[world.changelogReleaseVersion, [world.changelogSharedId.repeat(40)]]];
  if (world.changelogHasPriorRelease) releases.push(["1.0.0", ["a".repeat(40)]]);
  assert.deepEqual(document.releases.map(release => [release.version, release.entries.map(entry => entry.sha)]), releases);
}

Then("Git either preserves new work in Staging or reports a changelog conflict", function ()
{
  if (this.changelogGitMerge.status === 0)
  {
    assertReleaseAssignments(this, this.changelogGitMergedText);
    return;
  }
  assert.ok(this.changelogGitMerge.stdout.includes("CONFLICT"), this.changelogGitMerge.stdout);
  assert.ok(this.changelogGitMerge.stdout.includes("CHANGELOG.md"), this.changelogGitMerge.stdout);
  assert.throws(() => parseChangelog(this.changelogGitMergedText), /Invalid changelog/);
});

Then("the managed changelog merge preserves the correct release assignment", function ()
{
  assertReleaseAssignments(this, mergeChangelogs(this.changelogRelease, this.changelogDevelopment));
});
