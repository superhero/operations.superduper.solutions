// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { workflow, readExport } from './workspace.steps.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { gesture } from './workflow-single-input.steps.mjs';

Then('I can add and connect a vault variable without exposing its value', async function () {
  const page = this.page;
  await page.getByRole('button', { name: 'Add vault variable', exact: true }).click();
  const variable = workflow(page).locator('.svelte-flow__node-vault');
  await expect(variable).toHaveCount(1);
  await variable.getByRole('button', { name: 'Select vault variable', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select vault variable', exact: true });
  await picker.getByRole('combobox', { name: 'Vault variable', exact: true }).click();
  await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(variable.getByRole('button', { name: 'Change vault variable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const from = variable.getByLabel('Vault variable output (Text)', { exact: true });
  const to = workflow(page).getByLabel('Project ID input', { exact: true });
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
  await expect(variable.getByRole('button', { name: 'Change vault variable', exact: true })).toBeVisible();
  await variable.getByRole('button', { name: 'Change vault variable', exact: true }).click();
  const lockedPicker = page.getByRole('dialog', { name: 'Select vault variable', exact: true });
  await expect(lockedPicker.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await lockedPicker.getByRole('combobox', { name: 'Vault variable', exact: true }).click();
  await expect(page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await lockedPicker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(lockedPicker).toHaveCount(0);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = page.getByRole('dialog', { name: /^Run workflow:/ });
  await expect(run.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await run.getByLabel('Unlock password, or recovery key', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(run.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await expect(run.getByRole('alert')).toHaveCount(0);
});
