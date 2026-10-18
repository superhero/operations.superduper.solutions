// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode, workflow } from './workspace.steps.mjs';

async function preferences(page) {
  await setMode(page, 'settings');
  const section = page.locator('summary[aria-label="Keybindings"]');
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  return page.getByRole('group', { name: 'Keybindings preferences' });
}
async function bind(panel, action, shortcut, display) {
  const button = panel.getByRole('button', { name: `${action} shortcut`, exact: true });
  await button.click();
  await button.press(shortcut);
  await expect(button).toHaveText(display);
}
const selected = page => workflow(page).locator('.svelte-flow__node.selected');
const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id=${JSON.stringify(id)}]`);

Then('workflow shortcut preferences persist, prevent conflicts and preserve text editing', async function () {
  const page = this.page;
  let panel = await preferences(page);
  await bind(panel, 'Undo', 'Control+u', 'Ctrl/Cmd + U');
  await bind(panel, 'Redo', 'Control+r', 'Ctrl/Cmd + R');
  const all = panel.getByRole('button', { name: 'Select all shortcut', exact: true });
  await all.click();
  await all.press('Control+u');
  await expect(panel.getByRole('status')).toContainText('Already assigned to Undo');
  await all.press('Escape');
  await bind(panel, 'Select all', 'Control+q', 'Ctrl/Cmd + Q');
  // Reload proves startup reads the persisted bindings rather than just local component state.
  await expect.poll(() => page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('v1/settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('settings', 'readonly');
        const read = transaction.objectStore('settings').get('keybindings');
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
        transaction.oncomplete = () => db.close();
      };
    });
  })).toMatchObject({ undo: 'Mod+u', redo: 'Mod+r', selectAll: 'Mod+q' });
  await page.reload();
  panel = await preferences(page);
  await expect(panel.getByRole('button', { name: 'Undo shortcut', exact: true })).toHaveText('Ctrl/Cmd + U');
  await setMode(page, 'workflow');
  await workflow(page).focus();
  await page.keyboard.press('Control+q');
  await expect(selected(page)).toHaveCount(await workflow(page).locator('.svelte-flow__node').count());
  await page.keyboard.press('Escape');
  await workflow(page).getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(workflow(page).locator('.svelte-flow__node-comment')).toHaveCount(1);
  await expect(page.locator('.site-header .document-meta')).toContainText('Saved locally');
  await workflow(page).focus();
  await page.keyboard.press('Control+u');
  await expect(workflow(page).locator('.svelte-flow__node-comment')).toHaveCount(0);
  await page.keyboard.press('Control+r');
  await expect(workflow(page).locator('.svelte-flow__node-comment')).toHaveCount(1);
  await workflow(page).focus();
  await page.keyboard.press('Escape');
  const input = workflow(page).locator('.svelte-flow__node-comment textarea');
  await input.fill('Text editing');
  await input.press('Control+a');
  await expect.poll(() => input.evaluate(element => element.selectionEnd - element.selectionStart)).toBe(12);
  await input.press('Control+q');
  await expect(selected(page)).toHaveCount(0);
  panel = await preferences(page);
  await panel.getByRole('button', { name: 'Reset keybindings', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Undo shortcut', exact: true })).toHaveText('Ctrl/Cmd + Z');
});

Then('configured node and rectangle modifiers retain the selection group', async function () {
  const page = this.page;
  const panel = await preferences(page);
  const choose = async (label, option) => {
    await panel.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Add node to selection modifier', 'Alt/Option');
  await choose('Add area to selection modifier', 'Ctrl/Cmd');
  await setMode(page, 'workflow');
  await node(page, 'Selection owner').locator('.operation-title-row strong').click({ modifiers: ['Alt'] });
  await expect(selected(page)).toHaveCount(1);
  const box = await node(page, 'Other operation').boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.move(box.x - 2, box.y - 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 2, box.y + box.height + 8, { steps: 8 });
  await expect(workflow(page).locator('.svelte-flow__selection')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(selected(page)).toHaveCount(2);
  await node(page, 'Selection owner').locator('.operation-title-row strong').click({ modifiers: ['Alt'] });
  await expect(selected(page)).toHaveCount(1);
});
