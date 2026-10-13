// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mergeChangelogs, releaseChangelog } from "./changelog.mjs";

const SHA = /^[0-9a-f]{40}$/;
function authenticatedEnvironment(token)
{
  return token ? {
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  } : {};
}
function git(args, { input, env, allowFailure = false } = {})
{
  const result = spawnSync("git", args, {
    input, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result;
}

function changelog(tree)
{
  const entry = git(["ls-tree", tree, "--", "CHANGELOG.md"]).stdout.trim();
  if (!entry) return "";
  if (!entry.startsWith("100644 blob ")) throw new Error("CHANGELOG.md must be a regular non-executable file.");
  return git(["show", `${tree}:CHANGELOG.md`]).stdout;
}

function replaceChangelog(tree, text)
{
  const temporary = mkdtempSync(join(tmpdir(), "release-changelog-"));
  const env = { GIT_INDEX_FILE: join(temporary, "index") };
  try
  {
    const blob = git(["hash-object", "-w", "--stdin"], { input: text }).stdout.trim();
    git(["read-tree", tree], { env });
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},CHANGELOG.md`], { env });
    return git(["write-tree"], { env }).stdout.trim();
  }
  finally { rmSync(temporary, { recursive: true, force: true }); }
}

function commit(tree, parents, version)
{
  // Stable identity and time make an interrupted preparation reproducible.
  const date = Math.max(...parents.map(parent => Number(git(["show", "-s", "--format=%ct", parent]).stdout)));
  const env = {
    GIT_AUTHOR_NAME: "github-actions[bot]", GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]", GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_AUTHOR_DATE: `${date} +0000`, GIT_COMMITTER_DATE: `${date} +0000`,
  };
  return git(["commit-tree", tree, ...[...new Set(parents)].flatMap(parent => ["-p", parent])], {
    env, input: `chore(release): prepare ${version}\n\nFold Staging into ${version}.\n`,
  }).stdout.trim();
}

export function mergeReleaseTrees(target, source)
{
  const result = git(["merge-tree", "--write-tree", "-z", target, source], { allowFailure: true });
  const fields = result.stdout.split("\0");
  const tree = fields.shift();
  if (!SHA.test(tree)) throw new Error(`Could not integrate release commits: ${result.stderr.trim()}`);
  if (result.status !== 0)
  {
    const entries = fields.slice(0, fields.indexOf(""));
    if (!entries.length || entries.some(entry => !/^\d+ [0-9a-f]{40} [123]\tCHANGELOG\.md$/.test(entry)))
      throw new Error("Release integration has conflicts outside CHANGELOG.md; resolve them before retrying.");
  }
  const targetLog = changelog(target);
  const sourceLog = changelog(source);
  return targetLog || sourceLog ? replaceChangelog(tree, mergeChangelogs(targetLog, sourceLog)) : tree;
}

export function prepareRelease({ source, main, version, head = source })
{
  for (const sha of [source, main, head])
  {
    if (!SHA.test(sha)) throw new Error("Release preparation requires full commit SHAs.");
    if (git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }).status !== 0)
    {
      const repository = process.env.REPOSITORY ?? process.env.GITHUB_REPOSITORY;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error(`Commit ${sha} is unavailable in the checkout.`);
      git(["fetch", "--no-tags", `https://github.com/${repository}.git`, sha], {
        env: authenticatedEnvironment(process.env.GH_TOKEN),
      });
    }
  }
  if (version && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Release preparation requires a stable semantic version.");
  const integratedSource = head === source ? source :
    commit(mergeReleaseTrees(head, source), [head, source], version ?? "preview");
  const rawTree = mergeReleaseTrees(integratedSource, main);
  const changes = git(["diff", "--name-only", "--no-renames", "-z", main, rawTree]).stdout.split("\0").filter(Boolean);
  const substantive = changes.some(path => path === "CHANGELOG.md" ?
    mergeChangelogs(changelog(main)) !== mergeChangelogs(changelog(rawTree)) :
    !/^\.github\/badges\/version-dependency-[a-z0-9][a-z0-9._-]*\.svg$/.test(path));
  if (!version) return { tree: rawTree, substantive_changes: substantive };
  const document = changelog(rawTree);
  const tree = document ? replaceChangelog(rawTree, releaseChangelog(document, version)) : rawTree;
  const alreadyPrepared = git(["rev-parse", `${head}^{tree}`]).stdout.trim() === tree &&
    [source, main].every(parent => git(["merge-base", "--is-ancestor", parent, head], { allowFailure: true }).status === 0);
  return { tree, sha: alreadyPrepared ? head : commit(tree, [head, source, main], version), substantive_changes: substantive };
}

export function publishRelease({ remote, branch, expected, sha, token })
{
  if (!/^release\/\d+\.\d+\.\d+$/.test(branch) || !SHA.test(expected) || !SHA.test(sha))
    throw new Error("Publishing a release requires its version branch and exact expected and prepared SHAs.");
  git(["merge-base", "--is-ancestor", expected, sha]);
  const env = authenticatedEnvironment(token);
  git(["push", `--force-with-lease=refs/heads/${branch}:${expected}`, remote, `${sha}:refs/heads/${branch}`], { env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
  try
  {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "prepare")
    {
      const [source, main, version, head] = args;
      process.stdout.write(`${JSON.stringify(prepareRelease({ source, main, version, head }))}\n`);
    }
    else if (mode === "publish")
    {
      const [repository, branch, expected, sha] = args;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository identity.");
      publishRelease({ remote: `https://github.com/${repository}.git`, branch, expected, sha, token: process.env.GH_TOKEN });
    }
    else throw new Error("Usage: prepare-release-changelog.mjs prepare <source> <main> [version] [head] | publish <repository> <branch> <expected> <sha>");
  }
  catch (error) { process.stderr.write(`::error::${error.message}\n`); process.exitCode = 1; }
}
