// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, SHA, get } from "./support.mjs";

export const dependencyBadge = ".github/badges/version-dependency-vite.svg";
export function badgeAdvance(base, head, files = [{ filename: dependencyBadge }])
{
  return [get(`${API}/compare/${base}...${head}?per_page=100`, {
    status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1,
    base_commit: { sha: base }, merge_base_commit: { sha: base },
    commits: [{ sha: head, parents: [{ sha: base }] }]
  }), get(`${API}/commits/${head}?per_page=100`, { sha: head, files })];
}

Given("a badge advance contains {string}", function (change)
{
  const responses = badgeAdvance(BASE_SHA, OTHER_SHA);
  const comparison = responses[0].response;
  switch (change)
  {
    case "paginated badge commits":
      comparison.ahead_by = comparison.total_commits = 2;
      responses[0].pages = [
        { ...comparison, commits: [{ sha: SHA, parents: [{ sha: BASE_SHA }] }] },
        { ...comparison, commits: [{ sha: OTHER_SHA, parents: [{ sha: SHA }] }] }
      ];
      responses.splice(1, 0, get(`${API}/commits/${SHA}?per_page=100`, { sha: SHA, files: [{ filename: dependencyBadge }] }));
      responses[2].pages = [
        { sha: OTHER_SHA, files: [{ filename: dependencyBadge }] },
        { sha: OTHER_SHA, files: [{ filename: ".github/badges/version-dependency-svelte.svg" }] }
      ];
      break;
    case "a code change": responses[1].response.files[0].filename = "src/bootstrap.ts"; break;
    case "a coverage badge change": responses[1].response.files[0].filename = ".github/badges/test-coverage.svg"; break;
    case "a code file renamed into a badge": responses[1].response.files[0].previous_filename = "package.json"; break;
    case "a merge commit":
      comparison.commits[0].parents.push({ sha: SHA });
      responses.pop();
      break;
    case "unrelated history":
      comparison.status = "diverged";
      comparison.behind_by = 1;
      responses.pop();
      break;
    case "incomplete commit history":
      comparison.ahead_by = comparison.total_commits = 2;
      responses.pop();
      break;
    case "the file limit":
      responses[1].response.files = Array.from({ length: 3000 }, (_, index) => ({ filename: `.github/badges/version-dependency-package-${index}.svg` }));
      break;
    case "an API failure":
      Object.assign(responses[0], { exit_code: 1, stderr: "gh: HTTP 503\n" });
      responses.pop();
      break;
    default: assert.fail(`Unknown badge advance: ${change}`);
  }
  this.badgeAdvanceResponses = responses;
});

When("the badge-only advance is checked", function ()
{
  this.result = this.automation.execute("validate-badge-only-advance.sh", [REPOSITORY, BASE_SHA, OTHER_SHA],
    this.badgeAdvanceResponses, { success: null });
});

Then("the badge-only advance is {string}", function (outcome)
{
  assert.equal(this.result.status === 0, outcome === "accepted", this.result.stderr);
  if (outcome === "rejected")
    for (const value of [REPOSITORY, BASE_SHA, OTHER_SHA])
      assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
