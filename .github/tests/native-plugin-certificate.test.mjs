// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';

const fixture = new URL('../../tests/native-plugin-install-sdk.fixture.mjs', import.meta.url).href;

Then('actual plugin TLS signing verifies HTTPS and cleans its owned serial beneath a dotted runtime directory', { timeout: 20000 }, function () {
  const temporary = join(this.automation.root, 'browser', '.runtime');
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  // Isolate TMPDIR in a child so concurrent harness work keeps its own temp root.
  const script = `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { mkdir, readFile, readdir } from 'node:fs/promises';
    import { get } from 'node:https';
    import { dirname, join } from 'node:path';
    import { gunzipSync } from 'node:zlib';
    import { seedNativePluginInstallation } from ${JSON.stringify(fixture)};
    const temporary = process.env.TMPDIR, escaped = join(dirname(temporary), '.srl');
    const home = join(temporary, 'home'), workspace = join(temporary, 'workspace');
    await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
    assert.equal(existsSync(escaped), false);
    let backend, tlsRoot, authorized = false;
    try {
      backend = await seedNativePluginInstallation(home, workspace);
      const roots = (await readdir(temporary)).filter(name => name.startsWith('operations-native-tls-'));
      assert.equal(roots.length, 1); tlsRoot = join(temporary, roots[0]);
      assert.match(await readFile(join(tlsRoot, 'ca.srl'), 'utf8'), /^[0-9a-f]+\\r?\\n$/i);
      assert.equal(existsSync(escaped), false);
      const ca = await readFile(backend.caCertificate);
      const body = await new Promise((resolve, reject) => {
        const request = get(backend.installation.bundleUrl, { ca, rejectUnauthorized: true, timeout: 2000 }, response => {
          try {
            assert.equal(response.statusCode, 200);
            assert.equal(response.socket.authorized, true); authorized = true;
          } catch (error) { response.resume(); reject(error); return; }
          const chunks = []; response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject); response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Owned HTTPS request timed out.')));
      });
      assert.ok(gunzipSync(body).includes(Buffer.from('.codex-plugin/plugin.json')));
    } finally { await backend?.close(); }
    assert.ok(tlsRoot); assert.equal(existsSync(tlsRoot), false);
    assert.equal(existsSync(escaped), false);
    console.log(JSON.stringify({ serialContained: true, tlsAuthorized: authorized, rootRemoved: true, escapedSerial: false }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, TMPDIR: temporary }, encoding: 'utf8', timeout: 15000, maxBuffer: 16384,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { serialContained: true, tlsAuthorized: true, rootRemoved: true, escapedSerial: false });
});
