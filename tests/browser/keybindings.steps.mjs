// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeWorkflowDetails, workflowDetails } from './workflow-details.fixture.mjs';
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
  await bind(panel, 'Redo', 'Control+Shift+r', 'Ctrl/Cmd + Shift + R');
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
  })).toMatchObject({ undo: 'Mod+u', redo: 'Mod+Shift+r', selectAll: 'Mod+q' });
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
  await page.keyboard.press('Control+Shift+r');
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
  const choose = async (label, key) => {
    const button = panel.getByRole('button', { name: label, exact: true });
    await button.click();
    await button.press(key);
  };
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  const rows = panel.locator('.option');
  await expect(rows).toHaveCount(13);
  const sizes = [];
  for (const row of await rows.all()) {
    const label = await row.locator('span').boundingBox();
    const button = await row.getByRole('button').boundingBox();
    sizes.push({ width: button.width, height: button.height });
    expect(Math.abs(label.y + label.height / 2 - button.y - button.height / 2)).toBeLessThan(2);
  }
  expect(sizes.every(size => size.width === sizes[0].width && size.height === sizes[0].height)).toBe(true);
  await choose('Add node to selection modifier', 'Alt');
  await choose('Add area to selection modifier', 'Control');
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

Then('deletion shortcuts remove selected nodes and connections and respect editing fields', async function () {
  const page = this.page;
  const graph = workflow(page);
  const edge = graph.locator('.svelte-flow__edge[data-id="mapped-output"]');
  await edge.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(edge).toHaveCount(0);
  await graph.focus();
  await page.keyboard.press('Control+z');
  await expect(edge).toHaveCount(1);
  await node(page, 'Other operation').locator('.operation-title-row strong').click();
  await page.keyboard.press('Backspace');
  await expect(node(page, 'Other operation')).toHaveCount(0);
  await graph.focus();
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Other operation')).toHaveCount(1);
  const panel = await preferences(page);
  await bind(panel, 'Delete selection', 'Control+d', 'Ctrl/Cmd + D');
  await setMode(page, 'workflow');
  await node(page, 'Other operation').locator('.operation-title-row strong').click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(node(page, 'Other operation')).toHaveCount(1);
  await page.keyboard.press('Control+d');
  await expect(node(page, 'Other operation')).toHaveCount(0);
  await graph.getByRole('button', { name: 'Comment', exact: true }).click();
  const input = graph.locator('.svelte-flow__node-comment textarea');
  await input.fill('Keep');
  await input.press('End');
  await input.press('Backspace');
  await expect(input).toHaveValue('Kee');
  await input.press('Control+d');
  await expect(graph.locator('.svelte-flow__node-comment')).toHaveCount(1);
});

Then('workflow clipboard shortcuts and buttons preserve graphs across new workflows', async function () {
  const page = this.page, graph = workflow(page);
  const total = await graph.locator('.svelte-flow__node').count();
  await expect(graph.getByRole('button', { name: 'Paste', exact: true })).toBeDisabled();
  const mapping = graph.locator('.svelte-flow__edge[data-id="mapped-output"]');
  await mapping.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+x');
  await expect(mapping).toHaveCount(0);
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(total);
  await graph.focus();
  await page.keyboard.press('Control+z');
  await expect(mapping).toHaveCount(1);

  await node(page, 'Selection owner').locator('.operation-title-row strong').click();
  await graph.getByRole('button', { name: 'Copy selection', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled();
  await graph.focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect.poll(() => graph.locator('.svelte-flow__node').count()).toBeGreaterThan(total);
  const afterPaste = await graph.locator('.svelte-flow__node').count();
  await page.keyboard.press('Control+x');
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(total);
  await graph.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(afterPaste);
  await graph.getByRole('button', { name: 'Cut selection', exact: true }).click();
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(total);
  await graph.focus();
  await page.keyboard.press('Control+c');
  // An empty selection must not erase the previously copied graph.
  await page.keyboard.press('Control+n');
  await expect(workflowDetails(page)).toBeVisible();
  await closeWorkflowDetails(page);
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(0);
  await graph.focus();
  await page.keyboard.press('Control+v');
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(afterPaste - total);
  await expect(graph.locator('.svelte-flow__node.selected')).toHaveCount(afterPaste - total);
  await expect(page.locator('.site-header .document-meta')).toContainText('Saved locally');
  await page.reload();
  await setMode(page, 'workflow');
  await expect(graph.locator('.svelte-flow__node')).toHaveCount(afterPaste - total);
});

Then('the configurable open workflow shortcut opens the saved workflow picker', async function () {
  const page = this.page;
  await workflow(page).focus();
  await page.keyboard.press('Control+o');
  const picker = page.getByRole('dialog', { name: 'Saved workflows', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  const panel = await preferences(page);
  await bind(panel, 'Open workflow', 'Control+Shift+o', 'Ctrl/Cmd + Shift + O');
  await setMode(page, 'workflow');
  await workflow(page).focus();
  await page.keyboard.press('Control+o');
  await expect(picker).toBeHidden();
  await page.keyboard.press('Control+Shift+o');
  await expect(picker).toBeVisible();
});

Then('the run workflow shortcut opens the run view', async function () {
  const page = this.page;
  await workflow(page).focus();
  await page.keyboard.press('Control+r');
  await expect(page.getByRole('dialog', { name: /^Run workflow:/ })).toBeVisible();
});

Then('the history shortcut opens workflow history', async function () {
  const page = this.page;
  await workflow(page).focus();
  await page.keyboard.press('Control+h');
  await expect(page.getByRole('dialog', { name: 'Workflow history', exact: true })).toBeVisible();
});
