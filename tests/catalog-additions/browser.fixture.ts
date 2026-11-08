// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-only entry. No hooks or changes are installed in the shipped application.
import { operations, pinOperationModels } from '../../src/lib/catalog.ts';
import { bundledCatalogs } from '../../src/lib/catalog-registry.ts';
import { loadSchemaLibrary, getSchemaLibrary, setSchemaEnabled, hydrateOperation, createWorkflowSchemaLease, releaseSchemaSource } from '../../src/lib/schema-library.ts';
import { serviceSchemaDescriptors } from '../../src/lib/service-schema-packs.ts';
import { operationInsertionBlockReason } from '../../src/lib/operation-capabilities.ts';
import { getOperationReport } from '../../src/lib/operation-report.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { layoutAddedGraph } from '../../src/lib/workflow-layout.ts';
import { validateWorkflowDocument, type WorkflowDocument } from '../../src/lib/workflow-document.ts';
import { workflowRepository } from '../../src/lib/workflow-repository.ts';

const owner = {};
const lease = createWorkflowSchemaLease();
let current: WorkflowDocument | undefined;
let currentCatalog: string | undefined;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export async function initialize() {
  await loadSchemaLibrary();
  for (const record of getSchemaLibrary().records) if (!record.enabled) await setSchemaEnabled(record.id, true);
  check(!getSchemaLibrary().error, getSchemaLibrary().error);
  for (const catalog of serviceSchemaDescriptors)
    check(operations.filter(operation => operation.id.startsWith(catalog.id + ':')).length === catalog.operations,
      `Incomplete operation inventory for ${catalog.id}.`);
  for (const catalog of bundledCatalogs) check(operations.some(operation => operation.id.startsWith(catalog.id + ':')), `Missing example catalog ${catalog.id}.`);
  await workflowRepository.initialize();
  check((await workflowRepository.list()).length === 0, 'Audit must start with an empty isolated workflow store.');
  const names = new Map([...serviceSchemaDescriptors.map(catalog => [catalog.id, catalog.name] as const),
    ...bundledCatalogs.map(catalog => [catalog.id, catalog.name] as const)]);
  return operations.map(operation => {
    const catalog = operation.id.slice(0, operation.id.indexOf(':'));
    return { id: operation.id, name: operation.name, method: operation.method, path: operation.path, catalog,
      catalogName: names.get(catalog) ?? catalog, declaredUnavailable: operation.unavailableReason ?? null };
  }).sort((a, b) => a.catalog.localeCompare(b.catalog) || a.id.localeCompare(b.id));
}

export async function add(operationId: string, workflowId: string) {
  let stage = 'fresh-workflow';
  try {
    check(!current, 'The previous in-memory workflow must be removed first.');
    check((await workflowRepository.list()).length === 0, 'The previous persisted workflow must be removed first.');
    const catalog = operationId.slice(0, operationId.indexOf(':'));
    if (currentCatalog && currentCatalog !== catalog) releaseSchemaSource(currentCatalog);
    currentCatalog = catalog;
    current = { version: 2, id: workflowId, name: 'Catalog addition audit', nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
    pinOperationModels(owner, new Set([operationId]));
    stage = 'hydrate';
    const operation = await hydrateOperation(operationId);
    stage = 'capability';
    const blocked = operationInsertionBlockReason(operation);
    check(!blocked, blocked ?? 'Operation unavailable.');
    stage = 'graph';
    const nodeId = crypto.randomUUID();
    const graph = createOperationGraph(operation, { x: 200, y: 100 }, nodeId, getOperationReport(operation).schema);
    stage = 'layout';
    graph.nodes = layoutAddedGraph(graph.nodes, graph.edges, [], 8, nodeId);
    stage = 'validate';
    current = validateWorkflowDocument({ ...current, ...graph });
    check(current.nodes.filter(node => !node.type || node.type === 'operation').length === 1, 'A workflow must contain exactly one operation.');
    check(current.nodes.some(node => (!node.type || node.type === 'operation') && node.id === nodeId && node.data.operationId === operationId),
      'The workflow contains the wrong operation.');
    await lease.update(current);
    stage = 'save';
    await workflowRepository.save(current, null, 'Audit operation addition');
    stage = 'readback';
    const saved = await workflowRepository.list();
    check(saved.length === 1 && saved[0]!.id === workflowId, 'Only the current workflow may remain in storage.');
    check(saved[0]!.nodes.filter(node => !node.type || node.type === 'operation').length === 1, 'Persisted workflow must contain exactly one operation.');
    check(JSON.stringify(saved[0]!.nodes) === JSON.stringify(current.nodes) && JSON.stringify(saved[0]!.edges) === JSON.stringify(current.edges),
      'Saved operation graph differs from the added graph.');
    return { ok: true, stage: 'added', nodes: current.nodes.length, edges: current.edges.length, persistedWorkflows: saved.length };
  } catch (error) {
    return { ok: false, stage, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function remove(workflowId: string) {
  check(!current || current.id === workflowId, 'Cleanup must remove the current workflow.');
  lease.release(); pinOperationModels(owner);
  current = undefined;
  await workflowRepository.remove([workflowId]);
  const remaining = await workflowRepository.list();
  check(remaining.length === 0, 'Workflow deletion left a saved document.');
  return { remainingWorkflows: remaining.length };
}
