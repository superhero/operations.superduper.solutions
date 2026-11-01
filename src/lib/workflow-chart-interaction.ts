// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { ChartSnapshot } from "./workflow-chart.ts";
export type ChartPoint = readonly [number, number];
export type ChartPlot = { left: number; top: number; right: number; bottom: number };
export function chartGridLayout(multiple: boolean, legendHeight = 0) {
  return { left: 54, right: 20, top: multiple ? Math.max(40, legendHeight + 12) : 16, bottom: 70, outerBoundsMode: "none" as const };
}
export function chartPlotBounds(width: number, height: number, multiple: boolean, legendHeight = 0): ChartPlot {
  const grid = chartGridLayout(multiple, legendHeight);
  return { left: grid.left, top: grid.top, right: width - grid.right, bottom: height - grid.bottom };
}
/** Budget native wrapped legend rows with a small stroke allowance. Fall back to
 * paging when the full legend would crowd out the plot. Font measurement is supplied
 * by the renderer, keeping this layout contract independent of DOM/canvas state. */
export function chartLegendLayout(names: readonly string[], width: number, height: number, fontSize: number, measure: (name: string) => number) {
  const itemWidth = 14, itemGap = 10, lineHeight = fontSize + 6;
  const available = Math.max(1, width - 16), textWidth = Math.max(1, available - itemWidth - 9);
  let rows = 0, rowWidth = 0;
  const items = [...new Set(names)].map(name => {
    const measured = Math.ceil(measure(name)) + 2, labelWidth = Math.min(measured, textWidth);
    const itemSize = itemWidth + 9 + labelWidth;
    if (!rows || rowWidth && rowWidth + itemGap + itemSize > available) { rows++; rowWidth = 0; }
    rowWidth += (rowWidth ? itemGap : 0) + itemSize;
    return { name, width: labelWidth, truncated: measured > labelWidth };
  });
  const fullHeight = rows ? rows * lineHeight + (rows - 1) * itemGap : 0;
  const scroll = fullHeight > Math.max(lineHeight, Math.min(height * 0.35, height - 180));
  if (scroll) for (const item of items) {
    const capped = Math.min(item.width, Math.max(1, textWidth - 80));
    item.truncated ||= capped < item.width; item.width = capped;
  }
  return { items, scroll, height: scroll ? lineHeight : fullHeight, available, itemWidth, itemGap, lineHeight };
}
/** Plain drags select rectangles; Shift selects the dominant axis only. */
export function chartSelection(start: ChartPoint, end: ChartPoint, plot: ChartPlot, axisOnly = false) {
  if (plot.right <= plot.left || plot.bottom <= plot.top || start[0] < plot.left || start[0] > plot.right || start[1] < plot.top || start[1] > plot.bottom) return undefined;
  const x = Math.max(plot.left, Math.min(plot.right, end[0])), y = Math.max(plot.top, Math.min(plot.bottom, end[1]));
  const dx = Math.abs(x - start[0]), dy = Math.abs(y - start[1]);
  if (axisOnly ? Math.max(dx, dy) < 6 : Math.min(dx, dy) < 6) return undefined;
  const zoomX = !axisOnly || dx >= dy, zoomY = !axisOnly || dy > dx;
  return { left: zoomX ? Math.min(start[0], x) : plot.left, right: zoomX ? Math.max(start[0], x) : plot.right,
    top: zoomY ? Math.min(start[1], y) : plot.top, bottom: zoomY ? Math.max(start[1], y) : plot.bottom, zoomX, zoomY };
}
export type ChartRange = { start: number; end: number };
export const sankeyNodeKey = (name: string) => JSON.stringify(["node", name]);
export const sankeyLinkKey = (source: string, target: string) => JSON.stringify(["link", source, target]);
/** Combine the adjacency of explicitly clicked items using stable names, not indices. */
export function sankeyHighlights(graph: Pick<ChartSnapshot, "nodes" | "links">, selection: readonly string[]) {
  const keys = new Set(selection), selectedNodes = new Set<string>(), selectedLinks = new Set<string>();
  const nodes = new Set<string>(), links = new Set<string>();
  for (const node of graph.nodes) if (keys.has(sankeyNodeKey(node.name))) { selectedNodes.add(node.name); nodes.add(node.name); }
  for (const link of graph.links) {
    const key = sankeyLinkKey(link.source, link.target);
    if (keys.has(key)) selectedLinks.add(key);
    if (keys.has(key) || selectedNodes.has(link.source) || selectedNodes.has(link.target)) {
      links.add(key); nodes.add(link.source); nodes.add(link.target);
    }
  }
  return { selectedNodes, selectedLinks, nodes, links, active: selectedNodes.size + selectedLinks.size > 0 };
}
export type ChartInspection = {
  x: ChartRange; y: ChartRange; scale: number; selected: Record<string, boolean>;
  paused: boolean; frozen?: ChartSnapshot | undefined; filter: string; page: number; sankeySelection: string[]; legendScroll: number;
};
export function createChartInspection(): ChartInspection {
  return { x: { start: 0, end: 100 }, y: { start: 0, end: 100 }, scale: 1, selected: {}, paused: false, filter: "", page: 0, sankeySelection: [], legendScroll: 0 };
}
/** Zoom around the current centre and keep both handles inside the full range. */
export function zoomChartRange(range: ChartRange, factor: number): ChartRange {
  const width = Math.max(1, Math.min(100, (range.end - range.start) / factor));
  const start = Math.max(0, Math.min(100 - width, (range.start + range.end - width) / 2));
  return { start, end: start + width };
}
