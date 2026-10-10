// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { expect } from '@playwright/test';

export const workflowDetails = page => page.getByRole('dialog', { name: 'Workflow details', exact: true });
export const workflowNameInput = page => workflowDetails(page).getByRole('textbox', { name: 'Workflow name', exact: true });

export async function openWorkflowDetails(page) {
  const dialog = workflowDetails(page);
  if (!await dialog.isVisible()) await page.getByRole('button', { name: 'Workflow details', exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeWorkflowDetails(page) {
  const dialog = workflowDetails(page);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function expectWorkflowName(page, name) {
  const alreadyOpen = await workflowDetails(page).isVisible();
  await openWorkflowDetails(page);
  await expect(workflowNameInput(page)).toHaveValue(name);
  if (!alreadyOpen) await closeWorkflowDetails(page);
}

export async function renameWorkflow(page, name) {
  await openWorkflowDetails(page);
  await workflowNameInput(page).fill(name);
  // Closing retains the bound editor state and lets its normal autosave run.
  await closeWorkflowDetails(page);
}
