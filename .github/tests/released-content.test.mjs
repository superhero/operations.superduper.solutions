// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, get } from "./support.mjs";
import { dependencyBadge } from "./badge-advance.test.mjs";

export function releasedContent(released, candidate, files = [])
{
  const base = /^[a-f0-9]{40}$/.test(released) ? released : BASE_SHA;
  return get(`${API}/compare/${released}...${candidate}`, {
    status: base === candidate ? "identical" : "ahead", behind_by: 0,
    base_commit: { sha: base }, merge_base_commit: { sha: base }, files
  });
}

Given("released synchronization content includes {string}", function (change)
{
  this.releasedReference = change === "a tagged release" ? "1.2.3" : BASE_SHA;
  const response = releasedContent(this.releasedReference, OTHER_SHA);
  switch (change)
  {
    case "a reconciled squash merge":
    case "a tagged release": break;
    case "new dependency badges": response.response.files.push({ filename: dependencyBadge }); break;
    case "unpublished code": response.response.files.push({ filename: "src/bootstrap.ts" }); break;
    case "a code file renamed to a badge":
      response.response.files.push({ filename: dependencyBadge, previous_filename: "package.json" });
      break;
    case "unrelated history": response.response.behind_by = 1; response.response.status = "diverged"; break;
    case "an incomplete file comparison":
      response.response.files = Array.from({ length: 300 }, (_, index) => ({
        filename: `.github/badges/version-dependency-package-${index}.svg`
      }));
      break;
    case "a failed comparison": Object.assign(response, { exit_code: 1, stderr: "gh: HTTP 503\n" }); break;
    default: assert.fail(`Unknown released content: ${change}`);
  }
  this.releasedContentResponses = [response];
});

When("the released synchronization content is checked", function ()
{
  this.releasedContentResult = this.automation.execute("validate-released-content.sh",
    [REPOSITORY, this.releasedReference, OTHER_SHA], this.releasedContentResponses, { success: null });
});

Then("the released synchronization content is {string}", function (outcome)
{
  const result = this.releasedContentResult;
  assert.equal(result.status === 0, outcome === "accepted", result.stderr);
  if (outcome === "rejected")
    for (const value of [REPOSITORY, this.releasedReference, OTHER_SHA])
      assert.ok(result.stderr.includes(value), result.stderr);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
