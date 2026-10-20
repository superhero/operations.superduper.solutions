// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export async function expandSchemaCard(card) {
  const toggle = card.getByRole('button', { name: /^Schema details:/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return card;
}
