// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { githubRequest, githubDownload, ValidationRequestError, requestFailureDescription } from "../scripts/validation-request.mjs";

const endpoint = "repos/example/project/actions/runs/123";
const secret = "private-fixture-credential";
const signedUrl = `https://user:${secret}@example.invalid/artifact?signature=${secret}`;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

Before({ tags: "@validation-request" }, function ()
{
  const root = mkdtempSync(join(tmpdir(), "operations-validation-request-"));
  const responsePath = join(root, "response.json");
  const log = join(root, "command.json");
  const script = join(root, "fake-gh.mjs");
  writeFileSync(script, `import { readFileSync, writeFileSync } from "node:fs";
const response = JSON.parse(readFileSync(process.env.VALIDATION_RESPONSE, "utf8"));
writeFileSync(process.env.VALIDATION_COMMAND_LOG, JSON.stringify({ args: process.argv.slice(2), pid: process.pid }));
process.stdout.write(response.stdout ?? "");
process.stderr.write(response.stderr ?? "");
if (response.hang) setInterval(() => {}, 1000);
else process.exit(response.exitCode ?? 0);
`);
  writeFileSync(join(root, "gh"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o755 });
  this.validationRequest = { root, responsePath, log, env: { ...process.env,
    PATH: `${root}${delimiter}${process.env.PATH}`, GH_TOKEN: secret,
    VALIDATION_RESPONSE: responsePath, VALIDATION_COMMAND_LOG: log } };
});

After({ tags: "@validation-request" }, function ()
{
  rmSync(this.validationRequest.root, { recursive: true, force: true });
});

Given("the validation GitHub command returns {string}", function (kind)
{
  const state = this.validationRequest;
  const http = (status, headers = "Content-Type: application/json", body = JSON.stringify({ message: secret })) => ({
    stdout: `HTTP/2.0 ${status} Response\r\n${headers}\r\n\r\n${body}`,
    stderr: status >= 400 ? `gh: ${secret} (HTTP ${status})` : "", exitCode: status >= 400 ? 1 : 0
  });
  let response;
  if (/^(?:server|unauthorized|forbidden|missing) \d+$/.test(kind)) response = http(Number(kind.split(" ")[1]));
  else switch (kind)
  {
    case "successful JSON": response = http(200, "Content-Type: application/json", '{"verified":true}'); break;
    case "headerless JSON": response = { stdout: 'HTTP/2.0 200 OK\r\n\r\n{"verified":true}' }; break;
    case "rate limited 429": response = http(429, "Retry-After: 120"); break;
    case "exhausted rate limit 403": response = http(403, "X-RateLimit-Remaining: 0"); break;
    case "server retry-after": response = http(503, "Retry-After: 120"); break;
    case "malformed JSON": response = http(200, "Content-Type: application/json", `not JSON ${secret}`); break;
    case "missing HTTP headers": response = { stdout: JSON.stringify({ secret }) }; break;
    case "connection reset": response = { exitCode: 1, stderr: `Get "${signedUrl}": read: connection reset by peer` }; break;
    case "DNS interruption": response = { exitCode: 1, stderr: `Get "${signedUrl}": dial tcp: temporary failure in name resolution` }; break;
    case "request deadline": response = { exitCode: 1, stderr: `Get "${signedUrl}": context deadline exceeded` }; break;
    case "unknown CLI failure": response = { exitCode: 1, stderr: `Cannot access ${signedUrl}: ${secret}` }; break;
    case "download server 503": response = { exitCode: 1, stderr: `error downloading ${signedUrl}: HTTP 503` }; break;
    case "download missing 404": response = { exitCode: 1, stderr: `error downloading ${signedUrl}: HTTP 404` }; break;
    case "download rate limit": response = { exitCode: 1, stderr: `API rate limit exceeded for ${signedUrl} (HTTP 403)` }; break;
    case "download unexpected EOF": response = { exitCode: 1, stderr: `error downloading ${signedUrl}: unexpected EOF` }; break;
    case "a hanging process": response = { hang: true, stderr: secret }; state.timeoutMs = 1000; break;
    default: assert.fail(`Unknown GitHub command response: ${kind}`);
  }
  const status = /^HTTP\/[^ ]+ (\d{3})/.exec(response.stdout ?? "") ?? /\bHTTP (\d{3})\b/.exec(response.stderr ?? "");
  if (status) state.httpStatus = Number(status[1]);
  writeFileSync(state.responsePath, JSON.stringify(response));
});

When("the validation {string} adapter invokes the GitHub command", function (adapter)
{
  const state = this.validationRequest;
  const options = { timeoutMs: state.timeoutMs ?? 2000, env: state.env };
  try
  {
    state.value = adapter === "API" ? githubRequest(endpoint, options)
      : githubDownload("example/project", 123, "bundle", join(state.root, "bundle"), options);
  }
  catch (error) { state.error = error; }
  state.command = JSON.parse(readFileSync(state.log, "utf8"));
  assert.deepEqual(state.command.args, adapter === "API" ? ["api", "--include", endpoint]
    : ["run", "download", "123", "--repo", "example/project", "--name", "bundle", "--dir", join(state.root, "bundle")]);
});

Then("the validation API response is decoded", function ()
{
  assert.ifError(this.validationRequest.error);
  assert.deepEqual(this.validationRequest.value, { verified: true });
});

Then("the validation request failure is {string} with retry {string}", function (kind, retry)
{
  const error = this.validationRequest.error;
  assert.ok(error instanceof ValidationRequestError, "The subprocess adapter must return a classified failure.");
  assert.equal(error.kind, kind);
  assert.equal(error.retryable, retry === "true");
  if (this.validationRequest.httpStatus >= 400)
  {
    assert.equal(error.httpStatus, this.validationRequest.httpStatus);
    assert.ok(requestFailureDescription(error).includes(`HTTP ${this.validationRequest.httpStatus}`));
  }
});

Then("the request diagnostics contain no credentials or response body", function ()
{
  const error = this.validationRequest.error;
  const diagnostics = [error.message, error.stack, JSON.stringify(error), requestFailureDescription(error)].join("\n");
  for (const sensitive of [secret, signedUrl]) assert.ok(!diagnostics.includes(sensitive));
  for (const raw of ["stdout", "stderr", "output", "spawnargs"]) assert.equal(error[raw], undefined);
});

Then("the timed out validation command is no longer running", function ()
{
  assert.throws(() => process.kill(this.validationRequest.command.pid, 0), { code: "ESRCH" });
});
