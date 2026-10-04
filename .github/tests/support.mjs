// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { After, Before } from "@cucumber/cucumber";

export const REPOSITORY = "superhero/operations.superduper.solutions";
export const API = `repos/${REPOSITORY}`;
export const SHA = "a".repeat(40);
export const OTHER_SHA = "b".repeat(40);
export const BASE_SHA = "c".repeat(40);
export const get = (endpoint, response = {}, options = {}) => ({ method: "GET", endpoint, response, ...options });
export const post = (endpoint, response = {}, options = {}) => ({ method: "POST", endpoint, response, ...options });

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
const mock = fileURLToPath(new URL("./mock-command.mjs", import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

Before({ tags: "@automation" }, function ()
{
  const root = mkdtempSync(join(tmpdir(), "operations-automation-"));
  const output = join(root, "output");
  const queue = join(root, "queue.json");
  const log = join(root, "calls.jsonl");
  const errors = join(root, "mock-errors");
  for (const file of [output, log, errors]) writeFileSync(file, "");
  for (const command of ["gh", "curl", "npm", "sleep"])
  {
    writeFileSync(join(root, command),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mock)} ${command} "$@"\n`, { mode: 0o755 });
  }
  this.automation = {
    root,
    output,
    env: {
      PATH: `${root}${delimiter}${process.env.PATH}`,
      HOME: root,
      LANG: "C.UTF-8",
      TMPDIR: root,
      GITHUB_OUTPUT: output,
      MOCK_QUEUE: queue,
      MOCK_LOG: log,
      MOCK_ERRORS: errors,
      GH_TOKEN: "test-github-token",
      GH_APP_PRIVATE_KEY: "test-app-private-key",
      CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
      CLOUDFLARE_ACCOUNT_ID: "test-account"
    },
    calls: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse),
    execute(script, args, responses = [], { success = true, env = {} } = {})
    {
      writeFileSync(queue, JSON.stringify(responses));
      const environment = { ...this.env, ...env };
      const result = spawnSync("bash", [join(scripts, script), ...args], {
        cwd: root, env: environment, encoding: "utf8", timeout: 10000
      });
      assert.ifError(result.error);
      const diagnostics = result.stdout + result.stderr;
      assert.equal(readFileSync(errors, "utf8"), "", diagnostics);
      assert.deepEqual(JSON.parse(readFileSync(queue, "utf8")), [], diagnostics);
      if (success !== null) assert.equal(result.status === 0, success, diagnostics);
      for (const secret of [environment.GH_TOKEN, environment.GH_APP_PRIVATE_KEY, environment.CLOUDFLARE_API_TOKEN])
      {
        if (secret) assert.ok(!diagnostics.includes(secret), "Script output exposed a test credential");
      }
      return result;
    }
  };
});

After({ tags: "@automation" }, function ()
{
  if (this.automation) rmSync(this.automation.root, { recursive: true, force: true });
});
