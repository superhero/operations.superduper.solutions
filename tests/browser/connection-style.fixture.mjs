// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { expect } from '@playwright/test';
import { workflowLineStyles, workflowLineStyleLabels } from '../../src/lib/workflow-line-style.ts';

export async function chooseConnectionStyle(page, style) {
  const button = page.getByRole('button', { name: 'Connection style', exact: true });
  for (let i = 0; i < workflowLineStyles.length && await button.getAttribute('data-line-style') !== style; i++) await button.click();
  await expect(button).toHaveAttribute('data-line-style', style);
}

export async function toggleConnectionStyle(page) {
  const button = page.getByRole('button', { name: 'Connection style', exact: true });
  await chooseConnectionStyle(page, await button.getAttribute('data-line-style') === 'orthogonal' ? 'filleted' : 'orthogonal');
}

export async function chooseSettingsLineStyle(page, style) {
  const control = page.getByRole('slider', { name: 'Connection style', exact: true });
  await control.focus();
  await control.press('Home');
  for (let i = 0; i < workflowLineStyles.indexOf(style); i++) await control.press('ArrowRight');
  await expect(control).toHaveAttribute('aria-valuetext', workflowLineStyleLabels[style]);
}
