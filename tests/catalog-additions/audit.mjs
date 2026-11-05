// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';

/** Exact selections fail closed on typos; selection never hides an outcome. */
export function selectOperations(inventory, { catalogs = [], operations = [], limit } = {}) {
  for (const catalog of catalogs) if (!inventory.some(row => row.catalog === catalog)) throw new Error(`Unknown catalog ${catalog}`);
  const selected = inventory.filter(row => !catalogs.length || catalogs.includes(row.catalog));
  for (const id of operations) if (!selected.some(row => row.id === id)) throw new Error(`Unknown operation in selected catalogs: ${id}`);
  const exact = selected.filter(row => !operations.length || operations.includes(row.id));
  return limit ? exact.slice(0, limit) : exact;
}

/** Continue after insertion failures, but never continue with a retained workflow. */
export async function auditOperations(operations, adapter, record, nextId = randomUUID) {
  const ids = new Set();
  for (const operation of operations) {
    const workflowId = nextId();
    if (ids.has(workflowId)) throw new Error('Each operation requires a unique workflow ID.');
    ids.add(workflowId);
    const started = performance.now();
    let outcome, cleanup;
    try { outcome = await adapter.add(operation.id, workflowId); }
    catch (error) { outcome = { ok: false, stage: 'infrastructure', reason: error.message }; }
    try {
      cleanup = await adapter.remove(workflowId);
      if (cleanup.remainingWorkflows !== 0) throw new Error(`Cleanup retained ${cleanup.remainingWorkflows} workflows.`);
    } catch (error) {
      outcome = { ok: false, stage: 'cleanup', reason: [outcome.reason, error.message].filter(Boolean).join('; ') };
      // Closing the isolated context discards the entire old store and graph.
      // If that cannot be verified, stop instead of accumulating operations.
      await adapter.reset();
      cleanup = { remainingWorkflows: 0, contextReset: true };
    }
    await record({ ...operation, ...outcome, workflowId, cleanup, durationMs: Math.round(performance.now() - started) });
  }
}
