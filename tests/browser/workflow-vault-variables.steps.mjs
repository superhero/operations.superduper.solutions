// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { workflow, readExport, setMode } from './workspace.fixture.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { gesture } from './workflow-single-input.steps.mjs';

Then('I can add and connect a vault variable without exposing its value', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  const disclosure = page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  const secrets = page.getByRole('region', { name: 'Secrets vault', exact: true });
  await secrets.getByLabel('Credential label', { exact: true }).fill('Another vault key');
  await secrets.getByLabel('Credential value', { exact: true }).fill('another-synthetic-secret');
  // Lazy vault initialization adds controls after the disclosure first opens.
  // Its natural contents must remain reachable after that asynchronous growth.
  await expect.poll(() => secrets.evaluate(node => {
    const panel = node.closest('.disclosure-panel');
    return panel.clientHeight + 1 >= panel.scrollHeight;
  })).toBe(true);
  await secrets.getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(secrets.getByLabel('Credential label', { exact: true })).toHaveValue('');
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Add vault variable', exact: true }).click();
  const variable = workflow(page).locator('.svelte-flow__node-vault');
  await expect(variable).toHaveCount(1);
  const selection = variable.getByRole('combobox', { name: 'Vault variable', exact: true });
  await selection.click();
  await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  await expect(selection).toContainText('browser-PRIVATE-label-9182');
  await selection.click();
  await page.getByRole('option', { name: 'Another vault key', exact: true }).click();
  await expect(selection).toContainText('Another vault key');
  await selection.click();
  await page.getByRole('option', { name: 'Select vault variable', exact: true }).click();
  await expect(selection).toContainText('Select vault variable');
  await selection.click();
  await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  await expect(variable.locator('.utility-row .utility-type')).toHaveText('String');
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const from = variable.getByLabel('Vault variable output (Text)', { exact: true });
  const to = workflow(page).getByLabel('Path value input', { exact: true });
  await gesture(page, from, to, 'drag');
  const exported = (await readExport(page)).document;
  assert.equal(exported.nodes.find(node => node.type === 'vault').data.credentialId, undefined);
  assert.equal(exported.edges.filter(edge => edge.kind === 'mapping').length, 1);
  const stored = (await repository(page, 'list')).find(item => item.id === exported.id);
  assert.match(stored.nodes.find(node => node.type === 'vault').data.credentialId, /^[a-f0-9-]{36}$/);
  assert.ok(!JSON.stringify(stored).includes('browser-BEARER-canary-9182'));
  assert.ok(!JSON.stringify(stored).includes('browser-PRIVATE-label-9182'));
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(selection).toContainText('browser-PRIVATE-label-9182');
  await selection.click();
  await expect(page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Another vault key', exact: true }).click();
  await expect(selection).toContainText('Another vault key');
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Select vault variable', exact: true })).toHaveCount(0);
  await selection.click();
  await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = page.getByRole('dialog', { name: /^Run workflow:/ });
  await expect(run.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await run.getByLabel('Unlock password, or recovery key', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(run.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await expect(run.getByRole('alert')).toHaveCount(0);
});
