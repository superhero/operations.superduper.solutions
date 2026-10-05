// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, REPOSITORY, SHA, OTHER_SHA, get } from "./support.mjs";

const endpoint = `${API}/branches?per_page=100`;
const branch = (name, sha = SHA) => ({ name, commit: { sha }, protected: false });

Given("the dependency branch API returns multiple pages", function ()
{
  const first = [branch("main"), branch("develop"),
    ...Array.from({ length: 98 }, (_, index) => branch(`feature/change-${index}`))];
  const second = [branch("release/0.0.31", OTHER_SHA), branch("support/0.0.x"), branch("feature/quotes-'and-#%")];
  this.dependencyBranches = { pages: [first, second] };
});

Given("the dependency branch API fails", function ()
{
  this.dependencyBranches = { exit_code: 1, stderr: `HTTP 403: denied ${this.automation.env.GH_TOKEN}\n` };
});

Given("the dependency branch API returns {string}", function (data)
{
  const responses = {
    "malformed JSON": { raw: "not JSON" },
    empty: { response: [] },
    "invalid SHA": { response: [branch("main", "not-a-commit")] },
    "invalid ref": { response: [branch("feature/../bad")] },
    "257 branches": { response: Array.from({ length: 257 }, (_, index) => branch(`feature/change-${index}`)) }
  };
  assert.ok(Object.hasOwn(responses, data), `Unknown branch API data: ${data}`);
  this.dependencyBranches = responses[data];
});

When("dependency branches are discovered", function ()
{
  this.result = this.automation.execute("list-dependency-branches.sh", [REPOSITORY],
    [get(endpoint, {}, this.dependencyBranches)], { success: null });
});

Then("the dependency matrix contains every branch and its commit", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(this.result.stderr, "");
  const expected = this.dependencyBranches.pages.flat().map(({ name, commit }) => ({ branch: name, sha: commit.sha }));
  assert.deepEqual(JSON.parse(this.result.stdout), expected);
  assert.equal(this.result.stdout.trim().split("\n").length, 1);
});

Then("dependency branch discovery fails with {string}", function (reason)
{
  assert.notEqual(this.result.status, 0);
  assert.equal(this.result.stdout, "");
  for (const value of [reason, REPOSITORY, endpoint])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
});
