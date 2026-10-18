// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base } from 'vitest';
import { createServer } from 'node:http';

const record = (kind, details = {}) => appendFileSync(join(process.env.OPERATIONS_RUNNER_FIXTURE_OUTPUT,
  'ledger.ndjson'), `${JSON.stringify({ kind, ...details })}\n`);

export const test = base.extend('ownedRunnerResource',
  { scope: 'worker', auto: true }, async ({}, { onCleanup }) => {
    const server = createServer((_, response) => response.end('owned worker resource'));
    let port;
    // This is the same named fixture API as the production browser owner.
    // Register cleanup before startup, independently of a legacy use() promise.
    onCleanup(async () => {
      if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      record('worker-http-close', { pid: process.pid, port, listening: server.listening });
      record('worker-fixture-stop');
    });
    record('worker-fixture-start');
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
    port = server.address().port;
    record('worker-http-open', { pid: process.pid, port });
    return true;
  });
