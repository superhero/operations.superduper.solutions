// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { parseDocument } from "yaml";
import { API, get, OTHER_SHA, REPOSITORY, SHA } from "./support.mjs";

const endpoint = `${API}/pulls/37`;
const candidate = () => ({ number: 37, state: "open", merged: false, draft: false,
  head: { ref: "feature/topic", sha: SHA, repo: { full_name: REPOSITORY } },
  base: { ref: "develop", repo: { full_name: REPOSITORY } } });
const read = (pr = candidate()) => get(endpoint, pr);
const failure = kind => ({ exit_code: 1, stderr: `gh: private-refresh-response ${kind}` });
const write = kind => ({ method: "PUT", endpoint: `${endpoint}/update-branch`,
  fields: { expected_head_sha: SHA }, response: { message: "Updating pull request branch." },
  ...(kind ? failure(kind) : {}) });
const readFailure = kind => ({ ...read(), ...failure(kind) });

Given("the queued branch refresh encounters {string}", function (condition)
{
  const pr = candidate();
  const state = this.integrationRefresh = { responses: [], waits: [], env: {
    REPOSITORY, PR_NUMBER: "37", HEAD_SHA: SHA, HEAD_BRANCH: "feature/topic", BASE_BRANCH: "develop"
  } };
  switch (condition)
  {
    case "an unchanged candidate": state.responses = [read(), write()]; break;
    case "a closed candidate": pr.state = "closed"; state.responses = [read(pr)]; break;
    case "a merged candidate": pr.merged = true; state.responses = [read(pr)]; break;
    case "a draft candidate": pr.draft = true; state.responses = [read(pr)]; break;
    case "a newer source head": pr.head.sha = OTHER_SHA; state.responses = [read(pr)]; break;
    case "a changed source branch": pr.head.ref = "feature/other"; state.responses = [read(pr)]; break;
    case "a changed target branch": pr.base.ref = "main"; state.responses = [read(pr)]; break;
    case "a changed source repository": pr.head.repo.full_name = "foreign/project"; state.responses = [read(pr)]; break;
    case "a different pull request": pr.number = 38; state.responses = [read(pr)]; break;
    case "a rejected lease after the head advanced":
      pr.head.sha = OTHER_SHA;
      state.responses = [read(), write("HTTP 422"), read(pr)];
      break;
    case "a timed out write that already advanced the head":
      pr.head.sha = OTHER_SHA;
      state.responses = [read(), write("i/o timeout"), read(pr)];
      break;
    case "a transient write error after the candidate closed":
      pr.state = "closed";
      state.responses = [read(), write("HTTP 503"), read(pr)];
      break;
    case "a route change during write readback":
      pr.base.ref = "main";
      state.responses = [read(), write("HTTP 503"), read(pr)];
      break;
    case "a rejected update with the same live head":
      state.responses = [read(), write("HTTP 422"), read()];
      break;
    case "a transient write followed by success":
      state.responses = [read(), write("HTTP 503"), read(), read(), write()];
      state.waits = [1000];
      break;
    case "three transient writes with the same live head":
      state.responses = Array.from({ length: 3 }, () => [read(), write("HTTP 503"), read()]).flat();
      state.waits = [1000, 2000];
      break;
    case "the final timed out write already advanced the head":
      pr.head.sha = OTHER_SHA;
      state.responses = [read(), write("HTTP 503"), read(), read(), write("HTTP 503"), read(), read(), write("i/o timeout"), read(pr)];
      state.waits = [1000, 2000];
      break;
    case "a forbidden initial read": state.responses = [readFailure("HTTP 403")]; break;
    case "three transient initial reads":
      state.responses = Array.from({ length: 3 }, () => readFailure("HTTP 503"));
      state.waits = [1000, 2000];
      break;
    case "two transient reads followed by success":
      state.responses = [readFailure("HTTP 503"), readFailure("HTTP 503"), read(), write()];
      state.waits = [1000, 2000];
      break;
    case "an unverifiable write readback":
      state.responses = [read(), write("HTTP 503"), readFailure("HTTP 403")];
      break;
    case "malformed initial JSON": state.responses = [{ ...read(), raw: "private-refresh-response" }]; break;
    default: assert.fail(`Unknown refresh condition: ${condition}`);
  }
});

Given("the queued branch refresh has invalid {string}", function (field)
{
  const invalid = { REPOSITORY: "invalid", PR_NUMBER: "0", HEAD_SHA: "invalid",
    HEAD_BRANCH: "release/1.2.3", BASE_BRANCH: "main" };
  assert.ok(Object.hasOwn(invalid, field));
  this.integrationRefresh = { responses: [], waits: [], env: {
    REPOSITORY, PR_NUMBER: "37", HEAD_SHA: SHA, HEAD_BRANCH: "feature/topic", BASE_BRANCH: "develop",
    [field]: invalid[field]
  } };
});

When("the queued branch refresh script runs", function ()
{
  const document = parseDocument(readFileSync(new URL("../workflows/prepare-integration.yml", import.meta.url), "utf8"));
  assert.deepEqual(document.errors, []);
  const steps = document.toJS().jobs.refresh.steps.filter(step => step.run?.includes("/update-branch"));
  assert.equal(steps.length, 1, "Execute the credentialed refresh script from the actual workflow");
  const state = this.integrationRefresh;
  const timers = join(this.automation.root, "integration-refresh-timers.mjs");
  const timerLog = join(this.automation.root, "integration-refresh-waits.jsonl");
  writeFileSync(timerLog, "");
  // Keep the actual script and subprocess boundary intact; only advance its
  // retry delays immediately and record the requested backoff for assertions.
  writeFileSync(timers, `import { appendFileSync } from "node:fs";
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (callback, milliseconds, ...args) => {
  appendFileSync(process.env.INTEGRATION_REFRESH_WAITS, JSON.stringify(milliseconds) + "\\n");
  return schedule(callback, 0, ...args);
};
`);
  writeFileSync(this.automation.env.MOCK_QUEUE, JSON.stringify(state.responses));
  state.result = spawnSync("bash", ["-e", "-c", steps[0].run], {
    cwd: this.automation.root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...this.automation.env, ...state.env,
      NODE_OPTIONS: `--import=${pathToFileURL(timers).href}`, INTEGRATION_REFRESH_WAITS: timerLog }
  });
  assert.ifError(state.result.error);
  state.diagnostics = state.result.stdout + state.result.stderr;
  assert.equal(readFileSync(this.automation.env.MOCK_ERRORS, "utf8"), "", state.diagnostics);
  assert.deepEqual(JSON.parse(readFileSync(this.automation.env.MOCK_QUEUE, "utf8")), [], state.diagnostics);
  state.calls = this.automation.calls();
  assert.deepEqual(readFileSync(timerLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse), state.waits);
});

Then("branch refresh reports {string} after {int} reads and {int} writes", function (outcome, reads, writes)
{
  const state = this.integrationRefresh;
  const messages = { accepted: "Candidate update accepted.", skipped: "Candidate changed or closed;",
    "route rejected": "Pull request route changed;", "update failed": "Candidate update failed;",
    "read failed": "Cannot verify the current pull request;", "input rejected": "Invalid candidate update route." };
  assert.ok(Object.hasOwn(messages, outcome));
  assert.equal(state.result.status === 0, outcome === "accepted" || outcome === "skipped", state.diagnostics);
  assert.ok(state.diagnostics.includes(messages[outcome]), state.diagnostics);
  assert.equal(state.calls.filter(call => call.method === "GET").length, reads);
  assert.equal(state.calls.filter(call => call.method === "PUT").length, writes);
  if (outcome === "accepted") assert.match(state.diagnostics, /this run holds no validation proof/);
  else assert.doesNotMatch(state.diagnostics, /Candidate update accepted/);
});

Then("branch refresh uses the expected-head lease without exposing credentials", function ()
{
  const state = this.integrationRefresh;
  for (const call of state.calls)
  {
    assert.ok(call.method === "GET" || call.method === "PUT");
    assert.equal(call.endpoint, call.method === "GET" ? endpoint : `${endpoint}/update-branch`);
    assert.deepEqual(call.fields, call.method === "PUT" ? { expected_head_sha: SHA } : {});
  }
  for (const value of [this.automation.env.GH_TOKEN, this.automation.env.GH_APP_PRIVATE_KEY, "private-refresh-response"])
    assert.ok(!state.diagnostics.includes(value), "Refresh diagnostics must not expose tokens or raw API responses");
  assert.equal(readFileSync(this.automation.output, "utf8"), "", "A branch update cannot publish fresh validation outputs");
});
