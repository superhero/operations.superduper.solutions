// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import sharp from 'sharp';
import { cursorArtwork } from './lib/cursors/cursor-artwork.ts';
import { renderCursor, applyCursorTheme, syncCursorTheme } from './lib/cursors/cursor-theme.ts';
import { appearanceCacheKey, readAppearanceCache, writeAppearanceCache } from './lib/appearance-cache.ts';

const colors = { foreground: '#123456', outline: '#fedcba' };
function fakeRoot(mode = 'light') {
  const properties = new Map([['--unrelated', 'preserve']]);
  const palette = { '--color-foreground': colors.foreground, '--color-background': colors.outline };
  const writes = [];
  return { dataset: { theme: mode }, palette, properties, writes,
    style: {
      setProperty: (key, value) => { writes.push(key); properties.set(key, value); },
      removeProperty: key => { writes.push(key); properties.delete(key); },
    },
    ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: key => palette[key] }) } },
  };
}

Then('cursor artwork renders with theme colors native fallbacks and intact masks', async function () {
  for (const entry of cursorArtwork) for (const mode of ['light', 'dark']) {
    const result = renderCursor(entry.id, { ...colors, mode });
    assert.equal(decodeURIComponent(result.url.split(',')[1]), result.svg);
    assert.ok(result.value.endsWith(` ${entry.hotspot.join(' ')}, ${entry.keyword}`));
    assert.ok(entry.hotspot[0] < entry.width && entry.hotspot[1] < entry.height);
    assert.ok(result.svg.includes(colors.foreground) && result.svg.includes(colors.outline));
    assert.doesNotMatch(result.svg, /__CURSOR_|(?:href|src)=["'](?:https?:|\/)/);
    const { data, info } = await sharp(Buffer.from(result.svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, entry.width); assert.equal(info.height, entry.height);
    assert.ok(data.some((value, index) => index % 4 === 3 && value > 0));
    if (entry.id === 'not-allowed') {
      assert.deepEqual(entry.hotspot, [6, 3]);
      assert.match(result.svg, /fill="white"/); assert.match(result.svg, /fill="black"/);
      for (const [x, y] of [[22, 21], [19, 24]]) assert.equal(data[(y * info.width + x) * 4 + 3], 0, 'The badge interior stays transparent.');
    }
  }
  for (const id of ['pan-tool', 'grabbing'])
    assert.notEqual(renderCursor(id, { ...colors, mode: 'light' }).svg, renderCursor(id, { ...colors, mode: 'dark' }).svg);
});

Then('cursor rendering validates colors modes and artwork identifiers', function () {
  const theme = { ...colors, mode: 'light' };
  assert.throws(() => renderCursor('missing', theme), /Unknown cursor/);
  assert.throws(() => renderCursor('text', { ...theme, mode: 'other' }), /Invalid cursor mode/);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  try {
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: undefined });
    assert.throws(() => renderCursor('text', { ...theme, foreground: 'red' }), /concrete/);
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports: (_property, color) => color === 'rgb(1, 2, 3)' } });
    assert.ok(renderCursor('text', { ...theme, foreground: ' rgb(1, 2, 3) ' }).svg.includes('rgb(1, 2, 3)'));
    for (const foreground of ['', 'currentColor', 'CanvasText', 'var(--foreground)', 'env(color)', 'red; color:blue', 'red/*x*/', 'invalid'])
      assert.throws(() => renderCursor('text', { ...theme, foreground }), /concrete/);
    // Keep the XML boundary safe even if the platform color parser accepts new syntax.
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports: () => true } });
    const escaped = renderCursor('text', { ...theme, foreground: `a&<>"'` }).svg;
    assert.ok(escaped.includes('a&amp;&lt;&gt;&quot;&apos;'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'CSS', previous); else delete globalThis.CSS;
  }
});

Then('cursor theme application caches palettes and restores only its own native fallbacks', function () {
  const root = fakeRoot();
  assert.equal(applyCursorTheme(root, true), true);
  assert.equal(root.properties.size, 10); assert.equal(root.writes.length, 9);
  assert.equal(applyCursorTheme(root, true), false); assert.equal(root.writes.length, 9);
  root.dataset.theme = 'dark';
  assert.equal(applyCursorTheme(root, true), true);
  root.palette['--color-foreground'] = '#abcdef';
  assert.equal(applyCursorTheme(root, true), true);
  assert.ok(root.properties.get('--cursor-pointer').includes('%23abcdef'));
  assert.equal(applyCursorTheme(root, false), true);
  assert.deepEqual([...root.properties], [['--unrelated', 'preserve']]);
  assert.equal(applyCursorTheme(root, false), false);
  syncCursorTheme(root, true);
  assert.equal(root.properties.size, 10);
});

Then('cursor theme failures are atomic and reported without breaking the page', function () {
  const root = fakeRoot();
  applyCursorTheme(root, true);
  const snapshot = [...root.properties];
  root.palette['--color-background'] = 'var(--missing)';
  assert.throws(() => applyCursorTheme(root, true), /concrete/);
  assert.deepEqual([...root.properties], snapshot);
  const errors = [], previous = console.error;
  try { console.error = (...args) => errors.push(args); syncCursorTheme(root, true); }
  finally { console.error = previous; }
  assert.deepEqual([...root.properties], [['--unrelated', 'preserve']]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0].message, 'Could not apply custom cursors.');
  assert.ok(errors[0][0].cause instanceof TypeError);
  root.ownerDocument.defaultView = null;
  assert.throws(() => applyCursorTheme(root, true), /no document window/);
});

Then('the appearance cache validates custom cursor hints and handles unavailable storage', function () {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  const base = { version: 1, theme: 'dark', palette: 'spring' };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    } });
    assert.equal(readAppearanceCache(['spring']), null);
    values.set(appearanceCacheKey, JSON.stringify(base));
    assert.equal(readAppearanceCache(['spring']).customCursors, true);
    for (const customCursors of [false, true]) {
      writeAppearanceCache({ ...base, customCursors });
      assert.equal(readAppearanceCache(['spring']).customCursors, customCursors);
    }
    for (const customCursors of ['false', 0, null]) {
      values.set(appearanceCacheKey, JSON.stringify({ ...base, customCursors }));
      assert.equal(readAppearanceCache(['spring']), null);
    }
    values.set(appearanceCacheKey, JSON.stringify(base));
    assert.equal(readAppearanceCache(['default']), null);
    values.set(appearanceCacheKey, '{');
    assert.equal(readAppearanceCache(['spring']), null);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked'); } });
    assert.equal(readAppearanceCache(['spring']), null);
    assert.doesNotThrow(() => writeAppearanceCache({ ...base, customCursors: false }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});
