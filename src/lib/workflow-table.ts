// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { ChartSnapshot } from "./workflow-chart.ts";

export type TableColumnFormat = { kind: "number" | "boolean" | "text"; precision: number; format: (value: string) => string };

/** Find the shortest fixed decimal within a few floating-point steps. The absolute
 * cap prevents erasing real fractions on large numbers. Tiny values use scientific
 * notation rather than hundreds of padding zeroes. Raw cells are never changed. */
function decimalPrecision(value: number): number {
  const tolerance = Math.min(Math.abs(value) * Number.EPSILON * 8, 1e-8);
  for (let precision = 0; precision <= 20; precision++) {
    if (Math.abs(Number(value.toFixed(precision)) - value) <= tolerance) return precision;
  }
  return 21;
}

/** Infer using the entire retained window, before pagination or filtering. */
export function tableColumnFormats(table: Pick<ChartSnapshot, "columns" | "rows" | "rowTypes">): TableColumnFormat[] {
  return table.columns.map((_, index) => {
    const cells = table.rows.map((row, rowIndex) => ({ value: row[index] ?? "", type: table.rowTypes?.[rowIndex]?.[index] ?? "text" }))
      .filter(cell => cell.type !== "empty");
    const kind = cells.length && cells.every(cell => cell.type === "number") ? "number"
      : cells.length && cells.every(cell => cell.type === "boolean") ? "boolean" : "text";
    if (kind !== "number") return { kind, precision: 0, format: (value: string) => value };
    const values = cells.map(cell => Number(cell.value));
    const scientific = values.some(value => Math.abs(value) >= 1e21 || decimalPrecision(value) > 20);
    const precision = Math.max(...values.map(value => decimalPrecision(scientific ? Number(value.toExponential().split("e")[0]) : value)));
    const formatter = new Intl.NumberFormat("en-US", { useGrouping: false, minimumFractionDigits: precision,
      maximumFractionDigits: precision, notation: scientific ? "scientific" : "standard" });
    const formatted = new Map<string, string>();
    return { kind, precision, format: (value: string) => {
      if (value === "") return "";
      const cached = formatted.get(value);
      if (cached !== undefined) return cached;
      const number = Number(value);
      // Clean each value before padding: another row's finer precision must not
      // reintroduce this row's already-detected floating-point tail.
      const cleaned = scientific ? Number(number.toExponential(decimalPrecision(Number(number.toExponential().split("e")[0]))))
        : Number(number.toFixed(decimalPrecision(number)));
      const text = formatter.format(cleaned); formatted.set(value, text); return text;
    } };
  });
}
