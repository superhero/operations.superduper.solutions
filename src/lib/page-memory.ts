// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type PageMemoryReport = {
  total: number | null;
  groups: { label: string; bytes: number }[];
  unavailable: string | null;
  error: string | null;
};

type MemoryPerformance = Performance & { measureUserAgentSpecificMemory?: () => Promise<unknown> };
let pending: Promise<PageMemoryReport> | undefined;

const empty = (): PageMemoryReport => ({ total: null, groups: [], unavailable: null, error: null });
const bytes = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const failure = (error: unknown): PageMemoryReport => ({ ...empty(), error: error instanceof Error ? error.message : String(error) });

function summarize(value: unknown): PageMemoryReport
{
  if (!value || typeof value !== "object") throw new Error("The browser returned an invalid page memory measurement.");
  const measurement = value as { bytes?: unknown; breakdown?: unknown };
  const total = bytes(measurement.bytes);
  if (total === null) throw new Error("The browser returned an invalid page memory total.");
  const groups = new Map<string, { label: string; bytes: number }>();
  if (Array.isArray(measurement.breakdown)) for (const entry of measurement.breakdown)
  {
    if (!entry || typeof entry !== "object") continue;
    const size = bytes(entry.bytes);
    if (size === null) continue;
    const types = Array.isArray(entry.types)
      ? [...new Set(entry.types.filter((type: unknown): type is string => typeof type === "string" && type.length > 0))].sort() : [];
    if (!types.length && size === 0) continue;
    const key = JSON.stringify(types);
    const group = groups.get(key) ?? { label: types.join(" + ") || "Other", bytes: 0 };
    group.bytes += size;
    groups.set(key, group);
  }
  return { total, groups: [...groups.values()].sort((left, right) => right.bytes - left.bytes), unavailable: null, error: null };
}

/** Collect the browser's page memory estimate without retaining attribution URLs. */
export async function collectPageMemory(): Promise<PageMemoryReport>
{
  let timer: ReturnType<typeof setTimeout> | undefined;
  try
  {
    if (!globalThis.isSecureContext)
      return { ...empty(), unavailable: "Page memory measurement requires HTTPS or localhost." };
    if (!globalThis.crossOriginIsolated)
      return { ...empty(), unavailable: "Page memory measurement requires this page to be cross-origin isolated." };
    const performance = globalThis.performance as MemoryPerformance | undefined;
    const measure = performance?.measureUserAgentSpecificMemory;
    if (typeof measure !== "function")
      return { ...empty(), unavailable: "This browser does not support page memory measurement." };
    if (!pending)
    {
      // A timeout cannot cancel the native measurement. Keep sharing it until it settles.
      const request = Promise.resolve().then(() => measure.call(performance)).then(summarize).catch(failure)
        .finally(() => { if (pending === request) pending = undefined; });
      pending = request;
    }
    return await Promise.race([pending, new Promise<PageMemoryReport>(resolve => {
      timer = setTimeout(() => resolve(failure("Page memory measurement did not finish within 30 seconds. Try refreshing the measurements later.")), 30000);
    })]);
  }
  catch (error) { return failure(error); }
  finally { clearTimeout(timer); }
}
