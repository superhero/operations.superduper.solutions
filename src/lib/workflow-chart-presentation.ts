// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { ChartData } from "./workflow-chart.ts";

export type ChartPalette = { background: string; surface: string; foreground: string; muted: string; emphasis: string; colors: string[] };

/** Use active tone roles so light/dark changes follow the rest of the application. */
export function chartPalette(style: Pick<CSSStyleDeclaration, "getPropertyValue">): ChartPalette {
  const tones = Array.from({ length: 6 }, (_, index) => style.getPropertyValue(`--tone-${index + 1}`).trim());
  if (tones.some(color => !color)) throw new Error("The active theme must provide all six color tones.");
  return { background: tones[0]!, surface: tones[1]!, foreground: tones[5]!, muted: tones[4]!, emphasis: tones[3]!,
    // Reserve background/surface tones for the canvas and outlines, not invisible marks.
    colors: [tones[3]!, tones[2]!, tones[4]!, tones[5]!] };
}
function channels(color: string): number[] {
  const hex = /^#([\da-f]{6})$/i.exec(color);
  const channels = hex ? hex[1]!.match(/../g)!.map(value => parseInt(value, 16)) : color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error("The active theme must provide RGB color tones.");
  return channels;
}
function luminance(color: string): number {
  return channels(color).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}

/** Semantic hints blend into the palette; explicit labels carry the meaning too. */
export function tableBooleanStyles(palette: ChartPalette) {
  const tones = [palette.background, palette.surface, ...palette.colors].sort((a, b) => luminance(a) - luminance(b));
  const lightMode = luminance(palette.background) > luminance(palette.foreground);
  const ink = lightMode ? tones[0]! : tones.at(-1)!, paper = lightMode ? tones.at(-1)! : tones[0]!;
  const mix = (a: string, b: string, weight: number) => {
    const start = channels(a), end = channels(b);
    return `rgb(${start.map((value, index) => Math.round(value + (end[index]! - value) * weight)).join(", ")})`;
  };
  const style = (semantic: string) => {
    const background = mix(paper, semantic, 0.12);
    for (let weight = 0.8; weight >= 0; weight -= 0.05) {
      const color = mix(ink, semantic, Math.max(0, weight));
      const contrast = (Math.max(luminance(color), luminance(background)) + 0.05) / (Math.min(luminance(color), luminance(background)) + 0.05);
      if (contrast >= 4.6) return { color, background };
    }
    return { color: ink, background };
  };
  return { true: style(lightMode ? "#15803d" : "#86efac"), false: style(lightMode ? "#b91c1c" : "#fca5a5") };
}
/** Identity is independent of chart kind, node ID, arrival order and array position. */
export function chartIdentityStyle(name: string, palette: ChartPalette) {
  let hash = 0;
  for (const character of name.normalize("NFKC").trim().toLowerCase()) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  // Spread nearby names across the palette, then mix two authored tones. The
  // initial color depends only on the name; exact collisions are resolved below.
  let mixed = Math.imul(hash ^ hash >>> 16, 0x7feb352d);
  mixed = Math.imul(mixed ^ mixed >>> 15, 0x846ca68b);
  mixed = (mixed ^ mixed >>> 16) >>> 0;
  const first = mixed % palette.colors.length;
  const second = (first + 1 + (mixed >>> 2) % (palette.colors.length - 1)) % palette.colors.length;
  const weight = 0.08 + (mixed >>> 8) / 0xffffff * 0.84;
  const start = channels(palette.colors[first]!), end = channels(palette.colors[second]!);
  const color = `rgb(${start.map((value, index) => Math.round(value + (end[index]! - value) * weight)).join(", ")})`;
  const light = palette.background, dark = palette.foreground, value = luminance(color);
  const contrast = (candidate: string) => (Math.max(value, luminance(candidate)) + 0.05) / (Math.min(value, luminance(candidate)) + 0.05);
  const textColor = contrast(light) > contrast(dark) ? light : dark;
  const pattern = Math.floor(hash / palette.colors.length);
  return { color, textColor,
    symbol: ["circle", "rect", "triangle", "diamond", "roundRect", "pin"][pattern % 6]!,
    dash: (["solid", "dashed", "dotted"] as const)[pattern % 3]!,
    decal: { symbol: "rect", symbolSize: 1, color: textColor,
      dashArrayX: [1, 0], dashArrayY: [1, 8 + pattern % 3 * 3], rotation: pattern % 2 ? Math.PI / 4 : -Math.PI / 4 } };
}

/** Resolve exact RGB collisions in name order, retaining each name's pattern. */
export function chartNamedStyles(names: string[], palette: ChartPalette) {
  const key = (name: string) => name.normalize("NFKC").trim().toLowerCase();
  const keys = [...new Set(names.map(key))].sort();
  const originals = new Map(keys.map(name => [name, chartIdentityStyle(name, palette)]));
  const reserved = new Set([...originals.values()].map(style => style.color));
  const used = new Set<string>(), resolved = new Map<string, ReturnType<typeof chartIdentityStyle>>();
  for (const name of keys) {
    const original = originals.get(name)!;
    let visual = original;
    for (let attempt = 1; used.has(visual.color) && attempt <= 128; attempt++) {
      const candidate = chartIdentityStyle(`${name}\0${attempt}`, palette);
      if (reserved.has(candidate.color)) continue;
      visual = { ...original, color: candidate.color, textColor: candidate.textColor, decal: { ...original.decal, color: candidate.textColor } };
    }
    used.add(visual.color); resolved.set(name, visual);
  }
  return new Map(names.map(name => [name, resolved.get(key(name))!]));
}

/** A default single series takes its view title; explicitly named ports keep their identity. */
export function chartSeriesName(data: Pick<ChartData, "title" | "series">, series: { id: string; name: string }): string {
  return data.series.length === 1 && series.id === "value" && series.name === "Series 1" ? data.title : series.name;
}
