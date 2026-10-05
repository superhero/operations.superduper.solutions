// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Subprocess double: every external request must consume an expected fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
if (command === "sleep") process.exit(0);

try
{
  let request = { command: args };
  let query;
  if (command === "gh" && args[0] === "api")
  {
    request = { method: "GET", endpoint: undefined, fields: {} };
    for (let index = 1; index < args.length; index++)
    {
      const argument = args[index];
      if (argument === "--method") request.method = args[++index];
      else if (argument === "--jq") query = args[++index];
      else if (argument === "--input") request.body = JSON.parse(readFileSync(args[++index], "utf8"));
      else if (argument === "-f" || argument === "-F")
      {
        const field = args[++index];
        const separator = field.indexOf("=");
        assert.ok(separator > 0, "Expected a key=value API field");
        request.fields[field.slice(0, separator)] = field.slice(separator + 1);
      }
      else if (argument === "--paginate") continue;
      else
      {
        assert.ok(!argument.startsWith("-") && request.endpoint === undefined, `Unexpected gh argument: ${argument}`);
        request.endpoint = argument;
      }
    }
  }
  const queue = JSON.parse(readFileSync(process.env.MOCK_QUEUE, "utf8"));
  const expected = queue.shift();
  assert.ok(expected, `Unexpected ${command} request`);
  if (expected.executable) assert.equal(command, expected.executable);
  if (expected.command) assert.deepEqual(request.command, expected.command);
  else
  {
    assert.equal(request.method, expected.method ?? "GET");
    assert.equal(request.endpoint, expected.endpoint);
    for (const [key, value] of Object.entries(expected.fields ?? {})) assert.equal(request.fields[key], value);
    if (expected.body) assert.deepEqual(request.body, expected.body);
  }
  writeFileSync(process.env.MOCK_QUEUE, JSON.stringify(queue));
  appendFileSync(process.env.MOCK_LOG, JSON.stringify(request) + "\n");
  const response = expected.raw ?? (expected.pages ?? [expected.response ?? {}]).map((page) => JSON.stringify(page)).join("\n");
  if (expected.stderr) process.stderr.write(expected.stderr);
  if (query && !expected.exit_code)
  {
    const result = spawnSync("jq", ["-r", query], { input: response, encoding: "utf8" });
    assert.ifError(result.error);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status);
  }
  process.stdout.write(response);
  process.exit(expected.exit_code ?? 0);
}
catch (error)
{
  appendFileSync(process.env.MOCK_ERRORS, error.message + "\n");
  process.stderr.write(`Unexpected mock request: ${error.message}\n`);
  process.exit(1);
}
