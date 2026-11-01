// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const chartPatternKinds = ["line", "bar", "pie", "area", "scatter", "sankey"] as const;
export type PatternChartKind = typeof chartPatternKinds[number];
export type ChartPattern = "none" | "diagonal" | "vertical" | "horizontal" | "dots" | "dashed" | "dotted";
export type ChartSettings = { patterns: Record<PatternChartKind, ChartPattern> };
export const defaultChartSettings: ChartSettings = { patterns: { line: "none", bar: "none", pie: "none", area: "none", scatter: "none", sankey: "none" } };
const fills = [
  { value: "none", label: "Off" }, { value: "diagonal", label: "Diagonal lines" },
  { value: "vertical", label: "Vertical lines" }, { value: "horizontal", label: "Horizontal lines" }, { value: "dots", label: "Dots" }
] as const;
export function chartPatternOptions(kind: PatternChartKind) {
  return kind === "line" ? [{ value: "none", label: "Off (solid lines)" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }] : fills;
}
export function normalizeChartSettings(value: unknown): ChartSettings {
  const patterns = value && typeof value === "object" && "patterns" in value && value.patterns && typeof value.patterns === "object" ? value.patterns as Record<string, unknown> : {};
  return { patterns: Object.fromEntries(chartPatternKinds.map(kind => [kind,
    chartPatternOptions(kind).some(option => option.value === patterns[kind]) ? patterns[kind] : "none"])) as ChartSettings["patterns"] };
}
export function chartDecal(pattern: ChartPattern, color: string) {
  if (pattern === "none" || pattern === "dashed" || pattern === "dotted") return undefined;
  return pattern === "dots" ? { symbol: "circle", symbolSize: 0.6, color, dashArrayX: [1, 5], dashArrayY: [1, 5] }
    : { symbol: "rect", symbolSize: 1, color, dashArrayX: [1, 0], dashArrayY: [1, 9],
      rotation: pattern === "vertical" ? Math.PI / 2 : pattern === "diagonal" ? Math.PI / 4 : 0 };
}
