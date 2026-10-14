// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, SHA, get, post } from "./support.mjs";

const number = 71;
const branch = "docs/reusable-guide";
const prEndpoint = `${API}/pulls/${number}`;
const refEndpoint = (source = branch) => `${API}/git/ref/heads/${encodeURIComponent(source)}`;
const reference = (sha = SHA, source = branch) => ({ ref: `refs/heads/${source}`, object: { type: "commit", sha } });
const mergedPr = (base = "main", source = branch) => ({
  number, state: "closed", merged: true, draft: false,
  merged_at: "2026-10-14T10:00:00Z", merge_commit_sha: OTHER_SHA,
  head: { ref: source, sha: SHA, repo: { full_name: REPOSITORY } },
  base: { ref: base, sha: BASE_SHA, repo: { full_name: REPOSITORY } }
});
const http = (status, response, options = {}) => ({
  raw: `HTTP/2.0 ${status} Status\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(response)}`,
  exit_code: status < 400 ? 0 : 1,
  ...options
});
const missing = () => http(404, { message: "Not Found", status: "404" }, { stderr: "gh: Not Found (HTTP 404)\n" });
const readRef = (options = http(200, reference()), source = branch) => get(refEndpoint(source), {}, options);
const createRef = (options = http(201, reference()), source = branch) => post(`${API}/git/refs`, {}, {
  ...options, fields: { ref: `refs/heads/${source}`, sha: SHA }
});

Given("documentation source recovery targets original base {string} with {string}", function (base, state)
{
  const source = state === "a nested source branch" ? "docs/guide/setup" : branch;
  const pr = mergedPr(base, source);
  const initial = [get(prEndpoint, pr), readRef(missing(), source), get(prEndpoint, pr)];
  const fixtures = {
    "a deleted source after squash merge": [...initial, createRef(), readRef()],
    "a nested source branch": [...initial, createRef(http(201, reference(SHA, source)), source), readRef(http(200, reference(SHA, source)), source)],
    "an unchanged existing source": [get(prEndpoint, pr), readRef()],
    "an advanced existing source": [get(prEndpoint, pr), readRef(http(200, reference(OTHER_SHA)))],
    "a concurrent exact restore": [...initial, createRef(http(422, { message: "Reference already exists" })), readRef()],
    "a concurrent different restore": [...initial, createRef(http(422, { message: "Reference already exists" })), readRef(http(200, reference(OTHER_SHA)))],
    "a rejected create with no source": [...initial, createRef(http(422, { message: "Validation Failed" })), readRef(missing())],
    "a lost create response with exact source": [...initial, createRef({ raw: "", exit_code: 1, stderr: "connection reset\n" }), readRef()],
    "a lost create response with no source": [...initial, createRef({ raw: "", exit_code: 1, stderr: "connection reset\n" }), readRef(missing())],
    "a failed create and failed readback": [...initial, createRef(http(503, { message: "Unavailable" })), readRef(http(503, { message: "Unavailable" }))],
    "an invalid create response": [...initial, createRef(http(201, {}))],
    "a wrong create reference": [...initial, createRef(http(201, reference(SHA, "docs/other")))],
    "a wrong create SHA": [...initial, createRef(http(201, reference(OTHER_SHA)))],
    "an advanced source at readback": [...initial, createRef(), readRef(http(200, reference(OTHER_SHA)))],
    "a deleted source at readback": [...initial, createRef(), readRef(missing())],
    "an invalid readback": [...initial, createRef(), readRef(http(200, []))],
    "an API failure at readback": [...initial, createRef(), readRef(http(503, { message: "Unavailable" }))]
  };
  assert.ok(Object.hasOwn(fixtures, state), `Unknown recovery state: ${state}`);
  this.documentationRestore = { args: [REPOSITORY, String(number), source, SHA, base], responses: fixtures[state] };
});

Given("documentation source recovery has invalid argument {string} as {string}", function (argument, value)
{
  const names = ["repository", "PR number", "source branch", "head SHA", "original base"];
  const args = [REPOSITORY, String(number), branch, SHA, "main"];
  const index = names.indexOf(argument);
  assert.ok(index >= 0, `Unknown recovery argument: ${argument}`);
  args[index] = value;
  this.documentationRestore = { args, responses: [] };
});

function invalidPr(state)
{
  const pr = mergedPr();
  const mutations = {
    "wrong PR number": () => { pr.number++; },
    "string PR number": () => { pr.number = String(pr.number); },
    "wrong source branch": () => { pr.head.ref = "docs/other"; },
    "changed head SHA": () => { pr.head.sha = OTHER_SHA; },
    "fork source": () => { pr.head.repo.full_name = "someone/fork"; },
    "foreign base repository": () => { pr.base.repo.full_name = "someone/fork"; },
    "wrong original base": () => { pr.base.ref = "develop"; },
    "open PR": () => { pr.state = "open"; pr.merged = false; },
    "unmerged closed PR": () => { pr.merged = false; },
    "missing merged flag": () => { delete pr.merged; },
    "draft PR": () => { pr.draft = true; },
    "invalid merge SHA": () => { pr.merge_commit_sha = "bad"; },
    "missing merge SHA": () => { pr.merge_commit_sha = null; },
    "missing merged timestamp": () => { pr.merged_at = null; },
    "malformed merged timestamp": () => { pr.merged_at = "yesterday"; },
    "impossible merged timestamp": () => { pr.merged_at = "2026-02-30T10:00:00Z"; },
    "missing base SHA": () => { delete pr.base.sha; },
    "missing source repository": () => { pr.head.repo = null; }
  };
  const raw = {
    "malformed JSON": { raw: "not JSON" },
    "multiple PR objects": { raw: `${JSON.stringify(pr)}\n${JSON.stringify(pr)}` },
    "PR array": { response: [pr] },
    "empty PR response": { response: {} },
    "API failure": { exit_code: 1, stderr: "HTTP 503: unavailable\n" }
  };
  if (Object.hasOwn(raw, state)) return get(prEndpoint, {}, raw[state]);
  assert.ok(Object.hasOwn(mutations, state), `Unknown invalid PR state: ${state}`);
  mutations[state]();
  return get(prEndpoint, pr);
}

Given("documentation source recovery reads {string} for the merged PR", function (state)
{
  this.documentationRestore = {
    args: [REPOSITORY, String(number), branch, SHA, "main"], responses: [invalidPr(state)]
  };
});

Given("documentation source recovery reads {string} for the source ref", function (state)
{
  const fixtures = {
    "HTTP 401": http(401, { message: "Unauthorized" }),
    "HTTP 403": http(403, { message: "Forbidden" }),
    "HTTP 429": http(429, { message: "Rate limited" }),
    "HTTP 503": http(503, { message: "Unavailable" }),
    "404 only in stderr": { raw: "", exit_code: 1, stderr: "HTTP 404\n" },
    "404 only in JSON": { response: { message: "Not Found", status: "404" }, exit_code: 1 },
    "503 with a 404 body": http(503, { message: "Not Found", status: "404" }),
    "404 with invalid JSON": http(404, {}, { raw: "HTTP/2.0 404 Not Found\r\n\r\nnot JSON" }),
    "404 with unexpected body": http(404, {}),
    "404 with conflicting body status": http(404, { message: "Not Found", status: "403" }),
    "404 with successful exit": { ...missing(), exit_code: 0 },
    "incomplete 404 headers": { raw: "HTTP/2.0 404 Not Found\nContent-Type: application/json", exit_code: 1 },
    "200 with failed exit": http(200, reference(), { exit_code: 1 }),
    "wrong reference": http(200, reference(SHA, "docs/other")),
    "tag object": http(200, { ...reference(), object: { type: "tag", sha: SHA } }),
    "invalid SHA": http(200, reference("bad")),
    "reference array": http(200, [reference()]),
    "multiple references": http(200, {}, { raw: `HTTP/2.0 200 OK\n\n${JSON.stringify(reference())}\n${JSON.stringify(reference())}` })
  };
  assert.ok(Object.hasOwn(fixtures, state), `Unknown source response: ${state}`);
  this.documentationRestore = {
    args: [REPOSITORY, String(number), branch, SHA, "main"],
    responses: [get(prEndpoint, mergedPr()), readRef(fixtures[state])]
  };
});

Given("documentation source recovery encounters {string} at the PR recheck", function (state)
{
  const changedMetadata = { ...mergedPr(), merge_commit_sha: BASE_SHA };
  this.documentationRestore = {
    args: [REPOSITORY, String(number), branch, SHA, "main"],
    responses: [get(prEndpoint, mergedPr()), readRef(missing()),
      state === "changed merge metadata" ? get(prEndpoint, changedMetadata) : invalidPr(state)]
  };
});

When("the documentation source is explicitly restored", function ()
{
  const { args, responses } = this.documentationRestore;
  this.documentationRestore.result = this.automation.execute("restore-documentation-branch.sh", args, responses, { success: null });
});

When("the same documentation source recovery is retried", function ()
{
  assert.equal(this.documentationRestore.result.status, 0);
  const { args } = this.documentationRestore;
  this.documentationRestore.result = this.automation.execute("restore-documentation-branch.sh", args,
    [get(prEndpoint, mergedPr(args[4])), readRef()], { success: null });
});

Then("documentation source recovery is {string} with {string} and {int} create attempts", function (outcome, reason, expectedCreates)
{
  const { args, result } = this.documentationRestore;
  assert.equal(result.status === 0, outcome === "accepted", result.stdout + result.stderr);
  const output = outcome === "accepted" ? result.stdout : result.stderr;
  assert.ok(output.includes(reason), output);
  if (outcome === "accepted")
    for (const expected of [args[2], args[3]]) assert.ok(output.includes(expected), output);
  else
    for (const expected of args) assert.ok(output.includes(expected), output);
  const calls = this.automation.calls();
  const writes = calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, expectedCreates, JSON.stringify(calls));
  for (const call of calls)
  {
    assert.ok([prEndpoint, refEndpoint(args[2]), `${API}/git/refs`].includes(call.endpoint), call.endpoint);
    if (call.endpoint !== prEndpoint) assert.equal(call.include, true, "Ref requests must expose their HTTP status");
  }
  for (const call of writes)
  {
    assert.equal(call.method, "POST", "Recovery may only create refs, never update or delete them");
    assert.equal(call.endpoint, `${API}/git/refs`);
    assert.deepEqual(call.fields, { ref: `refs/heads/${args[2]}`, sha: SHA });
    assert.notEqual(call.fields.sha, mergedPr().merge_commit_sha, "A squash merge SHA must never replace the original head");
  }
});
