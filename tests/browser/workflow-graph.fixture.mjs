// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { operations } from '../../src/lib/catalog.ts';
import { catalogForOperation } from '../../src/lib/catalog-registry.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { layoutAddedGraph } from '../../src/lib/workflow-layout.ts';

// Use the real import and autosave paths. Import intentionally assigns a fresh
// document identity, so identity/history fixtures must keep repository setup.
export async function loadGraphFixture(page, document) {
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'graph-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator('.svelte-flow__node')).toHaveCount(document.nodes.filter(node => !node.hidden).length);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
}

export async function seedOperationGraph(page, names) {
  const nodes = [], edges = [];
  for (const [index, name] of names.entries()) {
    const operation = operations.find(operation => operation.name === name);
    assert.ok(operation, `Unknown fixture operation: ${name}`);
    const ownerId = `fixture-operation-${index}`;
    const graph = createOperationGraph(operation, { x: 400, y: 300 }, ownerId, catalogForOperation(operation.id).document);
    // Estimated layout gives fixtures clear columns; measured insertion layout
    // remains covered by the real catalog-add scenarios.
    nodes.push(...layoutAddedGraph(graph.nodes, graph.edges, nodes, 8, ownerId));
    edges.push(...graph.edges);
  }
  const pressed = async name => await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true';
  const [snap, curved, dashed] = await Promise.all(['Snap to grid', 'Connection style', 'Dashed connections'].map(pressed));
  await loadGraphFixture(page, { version: 2, id: randomUUID(), name: 'Untitled workflow', description: '', nodes, edges,
    viewport: { x: 0, y: 0, zoom: 1 }, snap, curved, dashed });
}
