// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { expect } from '@playwright/test';

/** Browse only visible direct descendants, like a user following a schema path. */
export async function catalogSchemaHeading(page, name) {
  let scope = page.getByRole('navigation', { name: 'Operation catalog', exact: true });
  const parts = name.split('/').map(part => part.trim()).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const heading = scope.locator([
      ':scope > .catalog-reorder > .catalog-branch > .catalog-group > summary',
      ':scope > .catalog-group > .disclosure-panel > .catalog-children > .catalog-branch > .catalog-group > summary',
    ].join(', ')).filter({ has: page.getByText(parts[index], { exact: true }) });
    await expect(heading).toBeVisible();
    if (index === parts.length - 1) return heading;
    if (await heading.getAttribute('aria-expanded') !== 'true') await heading.press('Enter');
    scope = heading.locator('xpath=../..');
  }
  throw new Error(`The schema path is empty: ${name}`);
}
