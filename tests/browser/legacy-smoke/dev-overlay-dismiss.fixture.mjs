// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createFixtureServer, ownedBrowser } from './support.mjs';

export async function* journey(world) {
  const root = resolve(world.artifactDirectory, 'app');
  await mkdir(root, { recursive: true });
  await cp(resolve('src'), root, { recursive: true });
  await writeFile(resolve(root, 'index.html'), '<!doctype html><html><body><button>Background control</button><script type="module" src="/broken.ts"></script></body></html>');
  await writeFile(resolve(root, 'broken.ts'), 'import "operations-missing-overlay-fixture"; globalThis.__applicationStarted = true;');
  const server = await createFixtureServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native', root,
    resolve: { alias: { $lib: resolve(root, 'lib') } }, cacheDir: resolve(world.artifactDirectory, '.vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === 'object');
    for (const [action, width] of [['button', 960], ['escape', 420]]) {
      const context = await ownedBrowser(world).newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
        const overlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText('operations-missing-overlay-fixture');
        const host = page.locator('vite-error-overlay');
        const payload = await host.evaluate(element => Reflect.get(element, '__v_oPayload'));
        assert.notEqual(payload.errorType, 'client', 'Exercise a genuine import failure, not a simulated runtime error.');
        assert.equal(await page.evaluate(() => globalThis.__applicationStarted), undefined);
        const close = overlay.getByRole('button', { name: 'Close error overlay', exact: true });
        await expect(close).toBeVisible();
        const button = await close.boundingBox();
        assert.ok(button && button.x >= 0 && button.x + button.width <= width, 'The close button fits on screen.');
        await page.screenshot({ path: `${world.artifactDirectory}/build-error-${action}.png` });
        if (action === 'button') await close.click();
        else await page.keyboard.press('Escape');
        await expect(overlay).toBeHidden();
        await expect(page.locator('html')).not.toHaveAttribute('data-error-overlay-open');
        assert.deepEqual(await host.evaluate(element => Reflect.get(element, '__v_oPayload')), payload,
          'Dismissal preserves the diagnostic payload.');
        await page.getByRole('button', { name: 'Background control', exact: true }).click();
      } finally { await context.close(); }
    }
    yield 'build errors support button and keyboard dismissal before application startup';
  } finally { await server.close(); }
}
