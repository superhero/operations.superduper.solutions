// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { processingPointer } from "./workflow-processing.ts";

export const chartKinds = ["line", "bar", "pie", "area", "scatter", "sankey", "table"] as const;
export type ChartKind = typeof chartKinds[number];
export type ChartSeries = { id: string; name: string; xPath: string; yPath: string };
export type ChartColumn = { id: string; label: string; path: string };
export type ChartData = {
  title: string; kind: ChartKind; xAxis: "category" | "value" | "time";
  xPath: string; yPath: string; series: ChartSeries[]; columns: ChartColumn[];
  nodePath: string; sourcePath: string; targetPath: string; weightPath: string;
  maxPoints: number; width: number; height: number;
};
export type ChartPoint = { x: string | number; y: number | null };
export type TableCellType = "number" | "boolean" | "text" | "empty";
export type ChartSnapshot = {
  nodeId: string; workflowId: string; path: string[]; configuration: string;
  series: { id: string; name: string; points: ChartPoint[]; received: number }[];
  nodes: { name: string }[]; links: { source: string; target: string; value: number }[];
  columns: { id: string; label: string }[]; rows: string[][]; rowTypes: TableCellType[][]; errors: Record<string, string>; error?: string;
};
export const coordinateChart = (kind: ChartKind) => ["line", "area", "bar", "scatter"].includes(kind);
export const chartResultKey = (workflowId: string, nodeId: string, path: readonly string[] = []) => JSON.stringify([workflowId, path, nodeId]);
export function defaultChartData(): ChartData {
  return { title: "Chart", kind: "line", xAxis: "category", xPath: "", yPath: "",
    series: [{ id: "value", name: "Series 1", xPath: "", yPath: "" }], columns: [],
    nodePath: "/name", sourcePath: "/source", targetPath: "/target", weightPath: "/value",
    maxPoints: 300, width: 360, height: 380 };
}
export function chartInputs(data: ChartData): { id: string; name: string }[] {
  if (coordinateChart(data.kind)) return data.series.map(({ id, name }) => ({ id, name }));
  if (data.kind === "sankey") return [{ id: "nodes", name: "Nodes" }, { id: "links", name: "Links" }];
  return [{ id: data.kind === "table" ? "rows" : "value", name: data.kind === "table" ? "Rows" : "Slices" }];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function label(value: unknown, limit = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Enter a name of 1–${limit} characters.`);
  return value;
}
function pointer(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || value !== "" && (!value.startsWith("/") || /~(?:[^01]|$)/.test(value)))
    throw new Error("Field paths must be JSON pointers of at most 512 characters, such as /cpu.");
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid visualization input identity.");
  return value;
}
export function validateChartData(value: unknown): ChartData {
  if (!object(value)) throw new Error("Expected chart configuration.");
  const base = defaultChartData(), data = value;
  const title = label(data.title);
  if (!chartKinds.includes(data.kind as ChartKind)) throw new Error("Choose a supported chart view.");
  if (!["category", "value", "time"].includes(data.xAxis as string)) throw new Error("Choose a supported chart X axis.");
  const xPath = pointer(data.xPath), yPath = pointer(data.yPath);
  const rawSeries = data.series ?? [{ id: "value", name: title, xPath, yPath }];
  if (!Array.isArray(rawSeries) || !rawSeries.length || rawSeries.length > 16) throw new Error("Use 1–16 named series.");
  const series = rawSeries.map(item => {
    if (!object(item)) throw new Error("Expected a named series.");
    return { id: identifier(item.id), name: label(item.name), xPath: pointer(item.xPath), yPath: pointer(item.yPath) };
  });
  if (new Set(series.map(item => item.id)).size !== series.length) throw new Error("Series identities must be unique.");
  const rawColumns = data.columns ?? [];
  if (!Array.isArray(rawColumns) || rawColumns.length > 32) throw new Error("Use at most 32 table columns.");
  const columns = rawColumns.map(item => {
    if (!object(item)) throw new Error("Expected a table column.");
    return { id: identifier(item.id), label: label(item.label), path: pointer(item.path) };
  });
  if (new Set(columns.map(item => item.id)).size !== columns.length) throw new Error("Column identities must be unique.");
  if (!Number.isInteger(data.maxPoints) || (data.maxPoints as number) < 1 || (data.maxPoints as number) > 2000)
    throw new Error("Use a point/row limit between 1 and 2000.");
  for (const [key, minimum, maximum] of [["width", 360, 2000], ["height", 320, 1600]] as const)
    if (typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < minimum || data[key] > maximum)
      throw new Error("Chart dimensions are outside the supported range.");
  return { title, kind: data.kind as ChartKind, xAxis: data.xAxis as ChartData["xAxis"], xPath, yPath, series, columns,
    nodePath: pointer(data.nodePath ?? base.nodePath), sourcePath: pointer(data.sourcePath ?? base.sourcePath),
    targetPath: pointer(data.targetPath ?? base.targetPath), weightPath: pointer(data.weightPath ?? base.weightPath),
    maxPoints: data.maxPoints as number, width: data.width as number, height: data.height as number };
}
/** Presentation-only edits do not invalidate the last result. */
export function chartConfigurationKey(data: ChartData): string {
  return JSON.stringify([data.kind, data.xAxis, data.xPath, data.yPath, data.series, data.columns,
    data.nodePath, data.sourcePath, data.targetPath, data.weightPath, data.maxPoints]);
}
export function chartPoints(value: unknown, data: ChartData, fields: Pick<ChartSeries, "xPath" | "yPath"> = data, offset = 0): ChartPoint[] {
  const rows = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const start = Math.max(0, rows.length - data.maxPoints);
  return rows.slice(start).map((row, index) => {
    const y = processingPointer(row, fields.yPath);
    if (y !== null && (typeof y !== "number" || !Number.isFinite(y)))
      throw new Error("The value field must contain finite numbers or null gaps. Select a numeric field, such as /cpu.");
    if (data.kind === "pie" && y !== null && y < 0) throw new Error("Pie chart values must be nonnegative.");
    let x = fields.xPath ? processingPointer(row, fields.xPath) : offset + start + index + 1;
    if (data.xAxis === "time" && data.kind !== "pie") {
      if (typeof x === "string" && /^\d{4}-\d\d-\d\dT/.test(x)) x = Date.parse(x);
      if (typeof x !== "number" || !Number.isFinite(x)) throw new Error("Time fields must contain epoch milliseconds or ISO timestamps.");
    } else if (data.xAxis === "value" && data.kind !== "pie") {
      if (typeof x !== "number" || !Number.isFinite(x)) throw new Error("Numeric X fields must contain finite numbers.");
    } else if (!(typeof x === "string" && x.length <= 200) && !(typeof x === "number" && Number.isFinite(x)))
      throw new Error("Label fields must contain text of at most 200 characters or finite numbers.");
    return { x: x as string | number, y: y as number | null };
  });
}
export function emptyChartSnapshot(nodeId: string, workflowId: string, data: ChartData): ChartSnapshot {
  return { nodeId, workflowId, path: [], configuration: chartConfigurationKey(data), series: [], nodes: [], links: [], columns: [], rows: [], rowTypes: [], errors: {} };
}
function collection(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  return (typeof value === "string" ? value : JSON.stringify(value) ?? "").slice(0, 500);
}
function sankeyError(snapshot: ChartSnapshot): string | undefined {
  const names = new Set(snapshot.nodes.map(node => node.name));
  if (names.size !== snapshot.nodes.length) return "Sankey node names must be unique.";
  const children = new Map(snapshot.nodes.map(node => [node.name, [] as string[]]));
  const incoming = new Map(snapshot.nodes.map(node => [node.name, 0]));
  for (const link of snapshot.links) {
    if (!names.has(link.source) || !names.has(link.target)) return "Each Sankey link must refer to a connected node.";
    children.get(link.source)!.push(link.target); incoming.set(link.target, incoming.get(link.target)! + 1);
  }
  const queue = [...names].filter(name => !incoming.get(name));
  for (let index = 0; index < queue.length; index++) for (const target of children.get(queue[index]!)!) {
    incoming.set(target, incoming.get(target)! - 1); if (!incoming.get(target)) queue.push(target);
  }
  return queue.length !== names.size ? "Sankey links must not form a cycle." : undefined;
}
/** Normalize at the input boundary; retained stream state contains only bounded display values. */
export function updateChartSnapshot(previous: ChartSnapshot | undefined, nodeId: string, workflowId: string, data: ChartData,
  handle: string, value: unknown, append = false): ChartSnapshot {
  const snapshot = previous?.configuration === chartConfigurationKey(data) ? structuredClone(previous) : emptyChartSnapshot(nodeId, workflowId, data);
  delete snapshot.errors[handle];
  try {
    if (!chartInputs(data).some(input => input.id === handle)) throw new Error("The selected view has no such input.");
    if (coordinateChart(data.kind) || data.kind === "pie") {
      const definition = data.kind === "pie" ? { id: "value", name: data.title, xPath: data.xPath, yPath: data.yPath } : data.series.find(item => item.id === handle)!;
      const prior = snapshot.series.find(item => item.id === handle);
      const points = chartPoints(value, data, definition, append ? prior?.received ?? 0 : 0);
      const received = (append ? prior?.received ?? 0 : 0) + collection(value).length;
      const result = { id: handle, name: definition.name, received,
        points: (append && data.kind !== "pie" ? [...(prior?.points ?? []), ...points] : points).slice(-data.maxPoints) };
      snapshot.series = [...snapshot.series.filter(item => item.id !== handle), result];
    } else if (data.kind === "table") {
      const values = collection(value).slice(-data.maxPoints);
      const keys = values.find(object);
      const columns = data.columns.length ? data.columns : snapshot.columns.length
        ? snapshot.columns.map(item => ({ ...item, path: item.id === "_value" ? "" : "/" + item.label.replace(/~/g, "~0").replace(/\//g, "~1") }))
        : keys ? Object.keys(keys).slice(0, 32).map((key, index) => ({ id: `column-${index}`, label: key, path: "/" + key.replace(/~/g, "~0").replace(/\//g, "~1") }))
          : [{ id: "_value", label: "Value", path: "" }];
      snapshot.columns = columns.map(({ id, label }) => ({ id, label }));
      const cells = values.map(row => columns.map(column => processingPointer(row, column.path)));
      const priorTypes = snapshot.rowTypes ?? snapshot.rows.map(row => row.map(() => "text" as const));
      snapshot.rows = [...(append ? snapshot.rows : []), ...cells.map(row => row.map(cell))].slice(-data.maxPoints);
      snapshot.rowTypes = [...(append ? priorTypes : []), ...cells.map(row => row.map((value): TableCellType =>
        value === undefined || value === null ? "empty" : typeof value === "boolean" ? "boolean" : typeof value === "number" && Number.isFinite(value) ? "number" : "text"))].slice(-data.maxPoints);
    } else if (handle === "nodes") {
      const values = collection(value);
      if (values.length > data.maxPoints) throw new Error("The Sankey node collection exceeds the configured limit.");
      snapshot.nodes = values.map(value => ({ name: label(typeof value === "string" ? value : processingPointer(value, data.nodePath), 200) }));
      if (new Set(snapshot.nodes.map(node => node.name)).size !== snapshot.nodes.length) throw new Error("Sankey node names must be unique.");
    } else {
      const values = collection(value);
      if (values.length > data.maxPoints) throw new Error("The Sankey link collection exceeds the configured limit.");
      snapshot.links = values.map(value => {
        const weight = processingPointer(value, data.weightPath);
        if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) throw new Error("Sankey link values must be finite nonnegative numbers.");
        return { source: label(processingPointer(value, data.sourcePath), 200), target: label(processingPointer(value, data.targetPath), 200), value: weight };
      });
    }
  } catch (cause) {
    snapshot.errors[handle] = cause instanceof Error ? cause.message : "The connected value could not be displayed.";
  }
  if (data.kind === "sankey") {
    delete snapshot.errors.graph;
    if (!snapshot.errors.nodes && !snapshot.errors.links) {
      const error = sankeyError(snapshot);
      if (error) snapshot.errors.graph = error;
    }
  }
  if (Object.keys(snapshot.errors).length) snapshot.error = Object.entries(snapshot.errors)
    .map(([id, message]) => `${id === "graph" && data.kind === "sankey" ? "Sankey" : chartInputs(data).find(input => input.id === id)?.name ?? id}: ${message}`).join(" ");
  else delete snapshot.error;
  return snapshot;
}
export function chartSnapshot(nodeId: string, workflowId: string, data: ChartData, value: unknown): ChartSnapshot {
  return updateChartSnapshot(undefined, nodeId, workflowId, data, chartInputs(data)[0]!.id, value);
}
