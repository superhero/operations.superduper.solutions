// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { expect } from '@playwright/test';

function readColors(element, { properties, pseudo = null, fromRoles = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const style = getComputedStyle(element, pseudo);
  return Object.fromEntries(Object.entries(properties).map(([property, role]) => {
    const color = fromRoles ? style.getPropertyValue(role).trim() : style[property];
    if (!color || !CSS.supports('color', color)) throw new Error(`Unresolved color: ${fromRoles ? role : property}`);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const rgba = [...context.getImageData(0, 0, 1, 1).data];
    const channels = rgba[3] === 255 ? rgba.slice(0, 3) : rgba;
    return [property, `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`];
  }));
}

// Resolve the expected contract from root roles after selecting the theme,
// independently of the control's own computed colors and local overrides.
export async function expectThemeColors(control, roles, pseudo = null) {
  const expected = await control.page().locator(':root').evaluate(readColors, { properties: roles, fromRoles: true });
  await expect.poll(() => control.evaluate(readColors, { properties: roles, pseudo })).toEqual(expected);
}
