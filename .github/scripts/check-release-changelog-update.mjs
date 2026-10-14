#!/usr/bin/env node
// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from "node:child_process";
import { releaseChangelog } from "./changelog.mjs";

// The caller checks the pinned commit ancestry and complete diff, including the
// ordinary file modes. Only trusted code reads these two existing Git blobs.
function isReleasePreparation()
{
  const [before, after, version] = process.argv.slice(2);
  if (process.argv.length !== 5 || ![before, after].every(sha => /^[0-9a-f]{40}$/.test(sha)))
    throw new Error("Expected two full changelog blob SHAs and a release version.");
  const blob = sha => execFileSync("git", ["cat-file", "blob", sha],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" } });
  const previous = blob(before);
  const current = blob(after);
  if (previous === current) return false;
  try
  {
    // An empty Latest still needs a review when this version heading is absent.
    // Require the exact canonical transition used by that review, including its
    // empty-release case, so its merge can resume publication.
    return releaseChangelog(previous, version) === current;
  }
  catch
  {
    // Authored Markdown and unrelated edits retain the documentation-only route.
    return false;
  }
}

try
{
  process.exitCode = isReleasePreparation() ? 0 : 1;
}
catch (error)
{
  console.error(`Could not read the release changelog update: ${error.message}`);
  process.exitCode = 2;
}
