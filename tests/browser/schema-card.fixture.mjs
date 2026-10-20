// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { expect } from '@playwright/test';

export async function revealSchemaCard(card) {
  await expect(card).toHaveCount(1);
  const ancestors = card.locator('xpath=ancestor::li[@data-schema-group]');
  for (const group of await ancestors.all()) {
    const summary = group.locator(':scope > .schema-name-group > summary');
    if (await summary.getAttribute('aria-expanded') !== 'true') await summary.press('Enter');
  }
  return card;
}

export async function expandSchemaGroups(section) {
  const closed = section.locator('.schema-name-group > summary[aria-expanded="false"]:visible');
  while (await closed.count()) await closed.first().press('Enter');
}

export async function expectSchemaName(card, fullName) {
  const label = card.locator('.schema-name-label');
  await expect(label).toHaveText(fullName.split('/').map(part => part.trim()).filter(Boolean).at(-1) ?? fullName);
  await expect(label).toHaveAccessibleName(`Open schema: ${fullName}`);
}

export async function expandSchemaCard(card) {
  await revealSchemaCard(card);
  const toggle = card.getByRole('button', { name: /^Schema details:/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return card;
}
