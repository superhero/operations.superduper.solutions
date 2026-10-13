#!/usr/bin/env node
// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { addCommits, mergeChangelogs, STAGING_TRAILER } from "./changelog.mjs";

const [base, head, repository, destination] = process.argv.slice(2);
if (process.argv.length !== 6 || ![base, head].every(sha => /^[0-9a-f]{40}$/.test(sha)))
  throw new Error("Expected full base and head SHAs, repository, and output path.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function changelog(sha)
{
  const entries = git("ls-tree", "-z", sha, "--", "CHANGELOG.md").split("\0").filter(Boolean);
  if (!entries.length) return "";
  if (entries.length !== 1 || !/^100644 blob [0-9a-f]{40}\tCHANGELOG\.md$/.test(entries[0]))
    throw new Error(`CHANGELOG.md at ${sha} must be an ordinary non-executable file.`);
  return git("show", `${sha}:CHANGELOG.md`);
}

// Walk the full Git graph, rather than the truncated compare/PR commits API.
const commits = git("rev-list", "--reverse", "--topo-order", `${base}..${head}`).trim().split("\n").filter(Boolean)
  .map(sha =>
  {
    const object = git("cat-file", "commit", sha);
    return { sha, message: object.slice(object.indexOf("\n\n") + 2) };
  })
  .filter(({ sha, message }) =>
  {
    const trailers = execFileSync("git", ["interpret-trailers", "--parse"], { input: message, encoding: "utf8" });
    if (!trailers.split("\n").includes(STAGING_TRAILER)) return true;
    const parents = git("rev-list", "--parents", "-n", "1", sha).trim().split(" ").slice(1);
    if (parents.length !== 1) return true;
    const paths = git("diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", sha)
      .split("\0").filter(Boolean);
    return paths.length !== 1 || paths[0] !== "CHANGELOG.md";
  });
writeFileSync(destination, addCommits(mergeChangelogs(changelog(base), changelog(head)), commits, repository));
