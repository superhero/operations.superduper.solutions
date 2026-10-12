// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, REPOSITORY, get } from "./support.mjs";

const endpoint = `${API}/actions/workflows/ci-main.yml/runs?status=in_progress&per_page=100`;
const run = (head_branch, id = 1) => ({ id, head_branch, status: "in_progress" });
const page = (workflow_runs, total_count = workflow_runs.length) => ({ total_count, workflow_runs });

Given("documentation publication inspection targets {string} with {string}", function (target, state)
{
  const fixtures = {
    "no active runs": { response: page([]) },
    "unrelated active runs": { response: page([run("docs/readme"), run("feature/editor", 2)]) },
    "an active release": { response: page([run("release/1.2.3")]) },
    "an active hotfix": { response: page([run("hotfix/1.2.3")]) },
    "release preparation": { response: page([run("develop")]) },
    "a release on page two": { pages: [page([run("docs/readme")], 2), page([run("release/1.2.3", 2)], 2)] },
    "an API failure": { exit_code: 1, stderr: "HTTP 503: unavailable\n" },
    "malformed JSON": { raw: "not JSON" },
    "an invalid response": { response: { total_count: 0, workflow_runs: null } },
    "an invalid branch": { response: page([run(null)]) },
    "an invalid run ID": { response: page([run("release/1.2.3", "1")]) },
    "an unexpected run status": { response: page([{ ...run("release/1.2.3"), status: "completed" }]) },
    "incomplete pagination": { response: page([run("docs/readme")], 2) },
    "duplicate run IDs": { response: page([run("docs/readme"), run("release/1.2.3")]) },
    "inconsistent page totals": { pages: [page([run("docs/readme")], 2), page([run("release/1.2.3", 2)], 3)] }
  };
  assert.ok(Object.hasOwn(fixtures, state), `Unknown documentation publication state: ${state}`);
  this.documentationPublication = { target, fixture: fixtures[state] };
});

When("documentation publication safety is checked", function ()
{
  const { target, fixture } = this.documentationPublication;
  this.documentationPublication.result = this.automation.execute("validate-documentation-merge.sh",
    [REPOSITORY, target], target === "main" ? [get(endpoint, {}, fixture)] : [], { success: null });
});

Then("documentation publication safety is {string} with {string}", function (outcome, reason)
{
  const { target, result } = this.documentationPublication;
  assert.equal(result.status === 0, outcome === "accepted", result.stdout + result.stderr);
  if (outcome === "rejected")
    for (const value of [reason, REPOSITORY, target])
      assert.ok(result.stderr.includes(value), result.stderr);
  const calls = this.automation.calls();
  assert.equal(calls.length, target === "main" ? 1 : 0);
  for (const call of calls)
  {
    assert.equal(call.method, "GET");
    assert.equal(call.endpoint, endpoint);
  }
});
