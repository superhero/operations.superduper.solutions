// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeCatalog } from './workspace.fixture.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';

Then('Fit View centers the graph between visible panes with {string} motion', async function (motion) {
  const page = this.page;
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.emulateMedia({ reducedMotion: motion });
  await closeCatalog(page);
  await loadGraphFixture(page, {
    version: 3, id: randomUUID(), name: 'Visible canvas fit', description: '',
    nodes: [
      { id: 'fit-first', type: 'cast', position: { x: -250, y: -120 }, data: { targetType: 'Text' } },
      { id: 'fit-last', type: 'cast', position: { x: 600, y: 340 }, data: { targetType: 'Number' } },
    ],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false,
  });
  const canvas = page.locator('.workflow-workspace');
  const nodes = canvas.locator('.svelte-flow__node');
  const menu = page.locator('.site-header [aria-controls="side-navigation"]');
  const settings = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  const fit = page.getByRole('button', { name: 'Fit View', exact: true });
  const positions = await nodes.evaluateAll(elements => elements.map(element => element.style.transform));

  async function checkFit() {
    // Pane state changes before its slide and the toolbar's resize finish.
    // Exercise Fit View with the requested panes fully open or closed.
    await page.evaluate(async () => {
      const elements = [...document.querySelectorAll('.workflow-toolbar, #side-navigation, #settings-panel')];
      await Promise.allSettled(elements.flatMap(element => element.getAnimations()).map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await fit.click();
    await expect.poll(async () => {
      const bounds = await canvas.boundingBox();
      const toolbar = await page.locator('.workflow-toolbar').boundingBox();
      const left = await menu.getAttribute('aria-expanded') === 'true'
        ? (await page.locator('#side-navigation').boundingBox()).x + (await page.locator('#side-navigation').boundingBox()).width : bounds.x;
      const right = await settings.getAttribute('aria-expanded') === 'true'
        ? (await page.locator('#settings-panel').boundingBox()).x : bounds.x + bounds.width;
      const top = toolbar.y + toolbar.height + 24, bottom = bounds.y + bounds.height - 24;
      const rectangles = await nodes.evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
      const graph = { left: Math.min(...rectangles.map(rect => rect.left)), right: Math.max(...rectangles.map(rect => rect.right)),
        top: Math.min(...rectangles.map(rect => rect.top)), bottom: Math.max(...rectangles.map(rect => rect.bottom)) };
      const contained = rectangles.every(rect => rect.left >= left + 24 && rect.right <= right - 24 && rect.top >= top && rect.bottom <= bottom);
      return contained && Math.abs((graph.left + graph.right) / 2 - (left + right) / 2) < 4 &&
        Math.abs((graph.top + graph.bottom) / 2 - (top + bottom) / 2) < 2;
    }, { message: 'Fit View must center every node inside the uncovered canvas, below the toolbar.' }).toBe(true);
    assert.deepEqual(await nodes.evaluateAll(elements => elements.map(element => element.style.transform)), positions,
      'Fitting changes the viewport, never the node positions.');
  }

  for (const [navigationOpen, settingsOpen] of [[false, false], [true, false], [false, true], [true, true]]) {
    if (await settings.getAttribute('aria-expanded') !== String(settingsOpen)) await settings.click();
    if (await menu.getAttribute('aria-expanded') !== String(navigationOpen)) await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', String(navigationOpen));
    await expect(settings).toHaveAttribute('aria-expanded', String(settingsOpen));
    await checkFit();
  }
  await page.getByRole('separator', { name: 'Navigation pane width', exact: true }).press('Shift+ArrowRight');
  await page.getByRole('separator', { name: 'Settings pane width', exact: true }).press('Shift+ArrowRight');
  await checkFit();
  await page.setViewportSize({ width: 1280, height: 844 });
  if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await checkFit();
  await settings.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await checkFit();
});
