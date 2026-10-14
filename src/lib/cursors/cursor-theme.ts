// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See ../../../LICENSE and ../../../LICENSE-ADDITIONAL-TERMS.

import { cursorArtwork } from './cursor-artwork.ts';
import { logger } from '../logger.ts';

export type CursorTheme = {
  mode: 'light' | 'dark';
  foreground: string;
  outline: string;
};

const roles = {
  default: 'arrow-selector-tool',
  pointer: 'touch-app',
  grab: 'pan-tool',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
  text: 'text',
  'ew-resize': 'ew-resize',
  'ns-resize': 'ns-resize',
  crosshair: 'crosshair',
} as const;

const artwork = new Map<string, (typeof cursorArtwork)[number]>(
  cursorArtwork.map(entry => [entry.id, entry]),
);
// One successful palette (or disabled state) per root; no event listeners.
const latest = new WeakMap<HTMLElement, string | null>();
const hex = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const contextualColors = new Set(`
  currentcolor inherit initial unset revert revert-layer
  accentcolor accentcolortext activetext buttonborder buttonface buttontext
  canvas canvastext field fieldtext graytext highlight highlighttext linktext
  mark marktext selecteditem selecteditemtext visitedtext
  activeborder activecaption appworkspace background buttonhighlight buttonshadow
  captiontext inactiveborder inactivecaption inactivecaptiontext infobackground
  infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight
  threedlightshadow threedshadow window windowframe windowtext
`.trim().split(/\s+/));

function concreteColor(input: string): string {
  const color = input.trim();
  if (hex.test(color)) return color;
  // SVG images cannot resolve page variables or contextual/system colors.
  const contextual = /(?:var|env|attr|light-dark)\s*\(/i.test(color)
    || (color.match(/[a-z][a-z-]*/gi) ?? []).some(token => contextualColors.has(token.toLowerCase()));
  if (!color || contextual || /[;{}\\]|\/\*/.test(color)
    || !globalThis.CSS?.supports('color', color)) {
    throw new TypeError(`Cursor color must be concrete and supported: ${input}`);
  }
  return color;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

/** Render immutable artwork; only the two palette placeholders are replaced.
 * Hex colors also work outside the browser. Other concrete CSS colors require
 * CSS.supports. Alternative artwork (such as circle-circle) is opt-in by id;
 * it never changes the active role mapping implicitly.
 */
export function renderCursor(id: string, theme: CursorTheme): {
  svg: string; url: string; value: string;
} {
  const entry = artwork.get(id);
  if (!entry) throw new RangeError(`Unknown cursor artwork: ${id}`);
  if (theme.mode !== 'light' && theme.mode !== 'dark') throw new TypeError('Invalid cursor mode');
  const colors = {
    FOREGROUND: escapeAttribute(concreteColor(theme.foreground)),
    OUTLINE: escapeAttribute(concreteColor(theme.outline)),
  };
  const svg = entry.variants[theme.mode].replace(
    /__CURSOR_(FOREGROUND|OUTLINE)__/g,
    (_, slot: keyof typeof colors) => colors[slot],
  );
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const [x, y] = entry.hotspot;
  return { svg, url, value: `url("${url}") ${x} ${y}, ${entry.keyword}` };
}

/** Call explicitly at startup and on palette/mode/preference changes.
 * Owns only the nine --cursor-* variables, not cursor selectors or root flags.
 * Returns whether styles changed. Invalid palettes throw before any writes;
 * callers can catch and call applyCursorTheme(root, false) for native fallback.
 * The variables must have one owner so an unchanged palette can be skipped.
 */
export function applyCursorTheme(root: HTMLElement, enabled: boolean): boolean {
  if (!enabled) {
    if (latest.get(root) === null) return false;
    for (const role of Object.keys(roles)) root.style.removeProperty(`--cursor-${role}`);
    latest.set(root, null);
    return true;
  }

  const view = root.ownerDocument.defaultView;
  if (!view) throw new Error('Cursor root has no document window');
  const computed = view.getComputedStyle(root);
  const theme: CursorTheme = {
    mode: root.dataset.theme === 'dark' ? 'dark' : 'light',
    foreground: computed.getPropertyValue('--color-foreground').trim(),
    outline: computed.getPropertyValue('--color-background').trim(),
  };
  const signature = JSON.stringify(theme);
  if (latest.get(root) === signature) return false;

  // Finish validation/rendering before touching any existing cursor variables.
  const values = Object.entries(roles).map(([role, id]) =>
    [`--cursor-${role}`, renderCursor(id, theme).value] as const);
  for (const [name, value] of values) root.style.setProperty(name, value);
  latest.set(root, signature);
  return true;
}

/** A bad palette must leave the page usable with its native cursor states. */
export function syncCursorTheme(root: HTMLElement, enabled: boolean): void {
  try { applyCursorTheme(root, enabled); }
  catch (cause) {
    applyCursorTheme(root, false);
    logger.error(new Error('Could not apply custom cursors.', { cause }));
  }
}
