// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { installAssistantFixture } from './browser-assistant.fixture.mjs';
import { setMode } from './workspace.fixture.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';

async function openAssistant(page) {
  await setMode(page, 'settings');
  const summary = page.locator('summary[aria-label="Assistant"]');
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  return page.getByRole('region', { name: 'Browser assistant', exact: true });
}
async function graph(page) {
  await loadGraphFixture(page, { version: 3, id: 'assistant-test', name: 'Assistant test', nodes: [
    { id: 'assistant-cast', type: 'cast', position: { x: 100, y: 100 }, data: { targetType: 'Text' } },
    { id: 'assistant-stop', type: 'stop', position: { x: 400, y: 100 }, data: {} },
  ], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });
}
Then('the assistant settings expose only three Bonsai models and remember configuration', async function() {
  const page = this.page; await installAssistantFixture(page);
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  let panel = await openAssistant(page);
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  await panel.getByRole('combobox', { name: 'Local model', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'Bonsai 2 · 4B', exact: true }).click();
  await panel.locator('summary').filter({ hasText: /^Configuration$/ }).click();
  await panel.getByLabel('Workspace editing', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'Check compatibility', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('WebGPU compute verified.');
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(1);
  await page.reload(); panel = await openAssistant(page);
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true }).locator('.field-select-value')).toHaveText('Bonsai 2 · 4B');
  await panel.locator('summary').filter({ hasText: /^Configuration$/ }).click();
  await expect(panel.getByLabel('Workspace editing', { exact: true })).not.toBeChecked();
  await panel.getByRole('button', { name: 'Load model', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Unload model', exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Unload model', exact: true }).click();
});
Then('the assistant can inspect add move and connect through the workspace UI boundary', async function() {
  const page = this.page; await installAssistantFixture(page); await graph(page);
  const panel = await openAssistant(page), requests = [];
  page.on('request', request => { if (request.url().startsWith('https://example.com/')) requests.push(request.url()); });
  await panel.getByRole('button', { name: 'Load model', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect and connect this workspace');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Done');
  const calls = await page.evaluate(() => window.assistantFixture.calls);
  for (const name of ['read_workflow','read_application','read_skill','add_operation','move_nodes','read_ports','connect_nodes'])
    expect(calls.filter(call => call.name === name).every(call => !call.error), `${name}: ${JSON.stringify(calls)}`).toBe(true);
  expect(calls.find(call => call.name === 'run_workflow').error).toContain('not available');
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
  await expect(page.locator('.svelte-flow__edge:not(.workflow-schema-edge)')).toHaveCount(1);
  const added = calls.find(call => call.name === 'add_operation').value.nodeId;
  const transform = await page.locator(`.svelte-flow__node[data-id="${added}"]`).getAttribute('style');
  expect(transform).toContain('720px'); expect(transform).toContain('320px');
  expect(requests).toHaveLength(0); await expect(panel.getByRole('log').locator('img')).toHaveCount(0);
  await this.attach(await panel.screenshot({ timeout: 5000 }), 'image/png');
  await expect(page.getByRole('dialog', { name: /^Run workflow:/ })).toHaveCount(0);
  await setMode(page, 'workflow');
  await page.getByRole('region', { name: 'Workflow canvas', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.svelte-flow__edge:not(.workflow-schema-edge)')).toHaveCount(0);
  await openAssistant(page);
  await page.locator('summary[aria-label="Assistant"]').click();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(0);
  await page.locator('summary[aria-label="Assistant"]').click();
  await expect(panel.getByRole('log')).toContainText('Done');
  await panel.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(panel.getByRole('log')).not.toContainText('Done');
});
Then('assistant read only mode and unload prevent further workspace edits', async function() {
  const page = this.page; await installAssistantFixture(page); await graph(page);
  const panel = await openAssistant(page);
  await panel.locator('summary').filter({ hasText: /^Configuration$/ }).click();
  await panel.getByLabel('Workspace editing', { exact: true }).uncheck();
  await panel.getByRole('button', { name: 'Load model', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect but do not edit');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Done');
  const calls = await page.evaluate(() => window.assistantFixture.calls);
  expect(calls.find(call => call.name === 'add_operation').error).toContain('not available');
  expect(calls.find(call => call.name === 'connect_nodes').error).toContain('not available');
  await expect(page.locator('.svelte-flow__node')).toHaveCount(2);
  await page.evaluate(() => window.assistantFixture.behavior = 'slow');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Wait');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await panel.getByRole('button', { name: 'Stop and unload', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(1);
});
Then('assistant messaging remains usable on a narrow viewport and reports failure', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openAssistant(page);
  await expect(panel.getByRole('button', { name: 'Load model', exact: true })).toBeVisible();
  const bounds = await panel.boundingBox(); expect(bounds.width).toBeLessThanOrEqual(390);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(() => window.assistantFixture.behavior = 'error');
  await panel.getByRole('button', { name: 'Load model', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Hi');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Synthetic inference failure');
  await expect(panel.getByRole('button', { name: 'Load model', exact: true })).toBeEnabled();
});
Then('the assistant checks its real browser worker without downloading model files', async function() {
  const page = this.page, requests = [];
  page.on('request', request => { if (/huggingface|\.gguf/.test(request.url())) requests.push(request.url()); });
  const panel = await openAssistant(page);
  await panel.getByRole('button', { name: 'Check compatibility', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Check compatibility', exact: true })).toBeEnabled({ timeout: 25000 });
  await expect(panel.getByRole('status')).toContainText(/WebGPU|HTTPS|localhost/);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
