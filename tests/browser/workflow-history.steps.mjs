// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { closeWorkflowDetails, expectWorkflowName, openWorkflowDetails, renameWorkflow, workflowNameInput } from './workflow-details.fixture.mjs';
import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode, workflow } from './workspace.steps.mjs';
import { repository, storedWorkflows, storageKey } from './workflow-storage.fixture.mjs';

const historyDialog = page => page.getByRole('dialog', { name: 'Workflow history', exact: true });
const revisionRow = (page, oid) => historyDialog(page).locator(`li[data-version-oid="${oid}"]`);
const restoreVersion = (page, oid) => revisionRow(page, oid).getByRole('button', { name: /^Restore version/ });
const saved = page => expect(page.locator(".site-header .document-meta").getByText('Saved locally', { exact: true })).toBeVisible();
const content = ({ viewport, snap, curved, dashed, ...document }) => document;
const document = (id, name) => ({ version: 3, id, name, description: '',
  nodes: [{ id: `${id}-cast`, type: 'cast', position: { x: 240, y: 120 }, data: { targetType: 'Text' } }], edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });
const graphCommit = (graph, oid) => graph.commits.find(commit => commit.oid === oid);
const graphContent = (graph, oid = graph.head) => JSON.parse(graphCommit(graph, oid).text);

function assertGraph(graph, selected, branches, count) {
  assert.equal(graph.headRef.trim(), 'ref: refs/heads/main');
  assert.equal(graph.head, selected);
  assert.deepEqual(graph.branches, branches);
  assert.equal(graph.commits.length, count);
  assert.equal(graph.working, graphCommit(graph, selected).text);
}

async function openHistory(page) {
  await page.getByRole('button', { name: 'Workflow history', exact: true }).click();
  await expect(historyDialog(page)).toBeVisible();
}

async function expectDirectRestoreActions(page, currentRevision) {
  const dialog = historyDialog(page);
  await expect(dialog.getByRole('button', { name: /Preview/i })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Version preview', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Workflow version JSON', { exact: true })).toHaveCount(0);
  await expect(restoreVersion(page, currentRevision)).toHaveCount(0);
  await expect(dialog.locator('code')).toHaveCount(0);
  const presentation = await dialog.evaluate(element => ({
    revisions: [...element.querySelectorAll('[data-version-oid]')].map(row => row.dataset.versionOid),
    text: [element.textContent, ...[...element.querySelectorAll('[aria-label], [title]')]
      .map(control => `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('title') ?? ''}`)].join('\n'),
  }));
  for (const oid of presentation.revisions)
    assert.equal(presentation.text.includes(oid.slice(0, 7)), false, 'History text and accessible labels must not display commit hashes.');
}

async function openWorkflow(page, name) {
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved workflows', exact: true }).locator('.document-entry')
    .filter({ has: page.getByText(name, { exact: true }) }).click();
  await expectWorkflowName(page, name);
}

Given('two independent Git workflows with saved versions', async function () {
  this.historyFirst = document('history-alpha', 'First workflow version');
  this.historyOther = document('history-beta', 'Independent workflow');
  const first = await repository(this.page, 'save', this.historyFirst, null, 'Create first workflow');
  await repository(this.page, 'save', this.historyOther, null, 'Create independent workflow');
  this.historyLatest = { ...this.historyFirst, name: 'Latest workflow version', description: 'A later graph',
    nodes: [...this.historyFirst.nodes, { id: 'later-comment', type: 'comment', position: { x: 580, y: 120 }, data: { text: 'Later work remains in history.' } }] };
  const latest = await repository(this.page, 'save', this.historyLatest, first.revision, 'Add a comment and rename');
  this.historyFirstOid = first.revision;
  this.historyLatestOid = latest.revision;
  this.historyOtherBefore = await repository(this.page, 'inspect', this.historyOther.id);
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await openWorkflow(this.page, this.historyLatest.name);
  await saved(this.page);
});

Then('each workflow has an independent Git repository in IndexedDB', async function () {
  const first = await repository(this.page, 'inspect', this.historyFirst.id);
  const second = await repository(this.page, 'inspect', this.historyOther.id);
  assert.notEqual(first.entry.repositoryPath, second.entry.repositoryPath);
  for (const inspected of [first, second]) {
    assert.match(inspected.entry.repositoryPath, /^\/repositories\/[^/]+$/);
    assert.deepEqual(Object.keys(inspected.entry).sort(), ['id', 'name', 'repositoryPath']);
    for (const file of ['HEAD', 'objects', 'refs']) assert.ok(inspected.gitFiles.includes(file));
    assert.deepEqual(inspected.trackedFiles, ['workflow.json']);
    assert.deepEqual(inspected.status, [['workflow.json', 1, 1, 1]]);
    assert.equal(inspected.working, `${JSON.stringify(JSON.parse(inspected.working), null, 2)}\n`);
    assert.equal(inspected.working, inspected.versions[0].text);
    for (const version of inspected.versions) assert.match(version.oid, /^[a-f0-9]{40}$/);
  }
  assert.equal(first.versions.length, 2);
  assert.deepEqual(first.versions[0].parent, [this.historyFirstOid]);
  assert.deepEqual(first.versions[1].parent, []);
  assert.deepEqual(JSON.parse(first.versions[1].text), content(this.historyFirst));
  assert.deepEqual(JSON.parse(first.versions[0].text), content(this.historyLatest));
  assert.equal(second.versions.length, 1);
  assert.deepEqual(JSON.parse(second.working), content(this.historyOther));
  await assert.rejects(repository(this.page, 'readVersion', this.historyFirst.id, second.versions[0].oid), /not in the workflow's history/);
});

Then('workflow preferences and unchanged content create no new commits', async function () {
  const before = await repository(this.page, 'inspect', this.historyFirst.id);
  const editedPreferences = { ...this.historyLatest, viewport: { x: 130, y: -70, zoom: 0.7 }, snap: true, curved: true, dashed: true };
  const result = await repository(this.page, 'save', editedPreferences, this.historyLatestOid);
  assert.equal(result.revision, this.historyLatestOid);
  await repository(this.page, 'save', editedPreferences, result.revision);
  const after = await repository(this.page, 'inspect', this.historyFirst.id);
  assert.deepEqual(after.versions, before.versions);
  assert.equal(after.working, before.working);
  assert.deepEqual(after.preferences, { viewport: editedPreferences.viewport, snap: true, curved: true, dashed: true });
  for (const key of ['viewport', 'snap', 'curved', 'dashed', 'selected']) assert.equal(key in JSON.parse(after.working), false);
  await this.page.reload();
  const reopened = await repository(this.page, 'load', this.historyFirst.id);
  assert.deepEqual(reopened.document, editedPreferences);
});

Then('workflow history records useful messages and derives legacy titles from the correct parents', async function () {
  const page = this.page;
  const initial = { ...document('history-messages', 'Message examples'), nodes: [] };
  const baseline = await repository(page, 'save', initial, null, 'Create message examples');
  const added = { ...initial, nodes: [{ id: 'project-lookup', type: 'operation', position: { x: 200, y: 100 },
    data: { operationId: 'demo:getProject', name: 'Get project', description: '', method: 'GET', path: '/projects/{projectId}' } }] };
  const addition = await repository(page, 'save', added, baseline.revision);
  const addedGraph = await repository(page, 'inspectGraph', initial.id);
  assert.match(graphCommit(addedGraph, addition.revision).message, /add.*Get project/i, 'New Git commits must store the useful description.');
  const moved = structuredClone(added);
  moved.nodes[0].position.x += 48;
  const legacyOid = await repository(page, 'legacyGenericVersion', moved);
  const legacyGraph = await repository(page, 'inspectGraph', initial.id);
  assert.equal(graphCommit(legacyGraph, legacyOid).message, 'Update workflow');
  const revisions = await repository(page, 'history', initial.id);
  assert.match(revisions.find(version => version.oid === legacyOid).message, /mov.*Get project/i);
  assert.deepEqual(await repository(page, 'inspectGraph', initial.id), legacyGraph, 'Reading a legacy title must not rewrite any Git objects or references.');

  await repository(page, 'undo', initial.id, legacyOid);
  const renamed = { ...added, name: 'Deployment plan' };
  const fork = await repository(page, 'save', renamed, addition.revision);
  const forkGraph = await repository(page, 'inspectGraph', initial.id);
  const forkCommit = graphCommit(forkGraph, fork.revision);
  assert.deepEqual(forkCommit.parent, [addition.revision]);
  assert.match(forkCommit.message, /renam|name/i);
  assert.match(forkCommit.message, /Deployment plan/);
  assert.doesNotMatch(forkCommit.message, /mov/i, 'A divergent rename must compare with its selected parent, not the abandoned moved version.');
  assert.deepEqual(graphCommit(forkGraph, legacyOid), graphCommit(legacyGraph, legacyOid));
  assert.ok(Object.values(forkGraph.branches).includes(legacyOid), 'The legacy future remains reachable after divergence.');
  await page.reload();
  await setMode(page, 'workflow');
  await openWorkflow(page, renamed.name);
  await openHistory(page);
  await expect(revisionRow(page, addition.revision).locator('.version-description > strong')).toContainText(/add.*Get project/i);
  await expect(revisionRow(page, legacyOid).locator('.version-description > strong')).toContainText(/mov.*Get project/i);
  await expect(revisionRow(page, fork.revision).locator('.version-description > strong')).toContainText(/Deployment plan/);
  assert.deepEqual(await repository(page, 'inspectGraph', initial.id), forkGraph, 'Displaying derived legacy titles must retain commit SHAs and the complete branch graph.');
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

When('I open workflow history', async function () {
  this.historyBeforeOpen = await repository(this.page, 'inspect', this.historyFirst.id);
  await openHistory(this.page);
  await expect(restoreVersion(this.page, this.historyFirstOid)).toBeVisible();
});

Then('history offers direct restore actions without changing the current workflow', async function () {
  await expectDirectRestoreActions(this.page, this.historyLatestOid);
  assert.deepEqual(await repository(this.page, 'inspect', this.historyFirst.id), this.historyBeforeOpen);
  await historyDialog(this.page).getByRole('button', { name: 'Close', exact: true }).click();
  await expectWorkflowName(this.page, this.historyLatest.name);
  await expect(workflow(this.page).locator('.svelte-flow__node-comment')).toHaveCount(1);
});

When('I restore the earliest workflow version', async function () {
  await restoreVersion(this.page, this.historyFirstOid).click();
  if (await historyDialog(this.page).isVisible()) await historyDialog(this.page).getByRole('button', { name: 'Close', exact: true }).click();
  await expectWorkflowName(this.page, this.historyFirst.name);
  await saved(this.page);
});

Then('the historical graph is restored while both workflows keep their history', async function () {
  const restored = await repository(this.page, 'inspect', this.historyFirst.id);
  assert.equal(restored.versions.length, 3);
  assert.deepEqual(restored.versions[0].parent, [this.historyLatestOid]);
  assert.deepEqual(restored.versions.slice(1), this.historyBeforeOpen.versions);
  assert.deepEqual(JSON.parse(restored.working), content(this.historyFirst));
  assert.deepEqual(await repository(this.page, 'inspect', this.historyOther.id), this.historyOtherBefore);
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await expectWorkflowName(this.page, this.historyFirst.name);
  await expect(workflow(this.page).locator('.svelte-flow__node-comment')).toHaveCount(0);
  await expect(workflow(this.page).locator('.svelte-flow__node-cast')).toHaveCount(1);
});

Then('workflow undo and redo remain available across reloads', async function () {
  const page = this.page;
  const before = await repository(page, 'inspectGraph', this.historyFirst.id);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectWorkflowName(page, this.historyFirst.name);
  await saved(page);
  const undone = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(undone, this.historyFirstOid, { main: this.historyFirstOid }, 2);
  assert.equal(undone.redo, this.historyLatestOid);
  assert.deepEqual(undone.commits, before.commits);
  const preferencesOnly = await repository(page, 'save', { ...this.historyFirst, snap: true }, this.historyFirstOid);
  assert.equal(preferencesOnly.revision, this.historyFirstOid);
  assert.equal(preferencesOnly.canRedo, true);
  assert.deepEqual((await repository(page, 'inspectGraph', this.historyFirst.id)).branches, undone.branches);
  await page.reload();
  await setMode(page, 'workflow');
  await expectWorkflowName(page, this.historyFirst.name);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectWorkflowName(page, this.historyLatest.name);
  await saved(page);
  const redone = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(redone, this.historyLatestOid, { main: this.historyLatestOid }, 2);
  assert.equal(redone.redo, null);
  assert.deepEqual(redone.commits, before.commits);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectWorkflowName(page, this.historyFirst.name);
  await renameWorkflow(page, 'New direction after undo');
  await saved(page);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  const history = await repository(page, 'history', this.historyFirst.id);
  assert.ok(history.some(version => version.oid === this.historyLatestOid), 'The old future remains in Git history.');
  const fork = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(fork, fork.head, { main: fork.head, 'stash-1': this.historyLatestOid }, 3);
  assert.deepEqual(graphCommit(fork, fork.head).parent, [this.historyFirstOid]);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('repeated edits after undo preserve the real Git branch tree', async function () {
  const page = this.page;
  await repository(page, 'undo', this.historyFirst.id, this.historyLatestOid);
  const firstFork = await repository(page, 'save', { ...this.historyFirst, name: 'First alternate future' }, this.historyFirstOid);
  await repository(page, 'undo', this.historyFirst.id, firstFork.revision);
  const secondFork = await repository(page, 'save', { ...this.historyFirst, name: 'Second alternate future' }, this.historyFirstOid);
  this.historyForkGraph = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(this.historyForkGraph, secondFork.revision, {
    main: secondFork.revision, 'stash-1': this.historyLatestOid, 'stash-2': firstFork.revision,
  }, 4);
  assert.equal(this.historyForkGraph.redo, null);
  for (const oid of [firstFork.revision, secondFork.revision, this.historyLatestOid])
    assert.deepEqual(graphCommit(this.historyForkGraph, oid).parent, [this.historyFirstOid]);
  assert.deepEqual(graphContent(this.historyForkGraph, this.historyLatestOid), content(this.historyLatest));
  const revisions = await repository(page, 'history', this.historyFirst.id);
  assert.equal(new Set(revisions.map(version => version.oid)).size, 4);
  for (const [branch, oid] of Object.entries(this.historyForkGraph.branches))
    assert.ok(revisions.find(version => version.oid === oid).branches.includes(branch));
  for (const version of revisions) for (const parent of version.parents)
    assert.ok(revisions.findIndex(candidate => candidate.oid === parent) > revisions.indexOf(version), 'Parents follow their children, including same-second commits.');
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
  await page.reload();
  await setMode(page, 'workflow');
  await expectWorkflowName(page, 'Second alternate future');
  await saved(page);
});

Then('the mobile history tree shows stashed futures without changing the workflow', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await repository(page, 'inspectGraph', this.historyFirst.id);
  await openHistory(page);
  const dialog = historyDialog(page);
  await expectDirectRestoreActions(page, before.head);
  await expect(dialog.locator('.version-graph circle[data-commit]')).toHaveCount(4);
  await expect(dialog.locator('.version-graph path[data-child][data-parent]')).toHaveCount(3);
  for (const commit of before.commits) {
    await expect(revisionRow(page, commit.oid)).toHaveCount(1);
    if (commit.oid !== before.head) await expect(restoreVersion(page, commit.oid)).toBeVisible();
    for (const parent of commit.parent)
      await expect(dialog.locator(`path[data-child="${commit.oid}"][data-parent="${parent}"]`)).toHaveCount(1);
  }
  await expect(dialog.locator('[data-branch]')).toHaveCount(0);
  await expect(dialog.getByLabel(/^Branch /)).toHaveCount(0);
  await page.screenshot({ path: 'tmp/test/workflow-history-tree-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'tmp/test/workflow-history-tree-desktop.png' });
  await dialog.evaluate(element => element.scrollTop = element.scrollHeight);
  await page.screenshot({ path: 'tmp/test/workflow-history-tree-ancestor.png' });
  await dialog.evaluate(element => element.scrollTop = 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await repository(page, 'inspectGraph', this.historyFirst.id), before, 'Opening history preserves working content, index, refs, and navigation.');
  const bounds = await dialog.evaluate(element => ({ width: element.scrollWidth, client: element.clientWidth,
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth }));
  assert.ok(bounds.width <= bounds.client + 1 && bounds.left >= 0 && bounds.right <= bounds.viewport, JSON.stringify(bounds));
});

Then('explicitly restoring a stashed version appends a commit while preserving all branches', async function () {
  const page = this.page;
  await restoreVersion(page, this.historyLatestOid).click();
  if (await historyDialog(page).isVisible()) await historyDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await saved(page);
  await expectWorkflowName(page, this.historyLatest.name);
  const restored = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(restored, restored.head, { ...this.historyForkGraph.branches, main: restored.head }, 5);
  assert.deepEqual(graphCommit(restored, restored.head).parent, [this.historyForkGraph.head]);
  assert.deepEqual(graphContent(restored), content(this.historyLatest));
  for (const commit of this.historyForkGraph.commits) assert.deepEqual(graphCommit(restored, commit.oid), commit);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('an identical same-second edit preserves a distinct abandoned commit', async function () {
  const page = this.page;
  const fork = await repository(page, 'sameSecondFork', this.historyLatest, this.historyFirstOid, this.historyLatestOid);
  assert.notEqual(fork.revision, this.historyLatestOid, 'A new edit is a distinct version even with identical content and time.');
  const graph = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(graph, fork.revision, { main: fork.revision, 'stash-1': this.historyLatestOid }, 3);
  const abandoned = graphCommit(graph, this.historyLatestOid);
  const current = graphCommit(graph, fork.revision);
  assert.equal(current.timestamp, abandoned.timestamp);
  assert.equal(current.text, abandoned.text);
  assert.deepEqual(current.parent, [this.historyFirstOid]);
  const history = await repository(page, 'history', this.historyFirst.id);
  assert.equal(history.length, 3);
  for (const version of history) assert.doesNotMatch(version.message, /Workflow-Change:/);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('simultaneous workflow saves serialize and reject the stale snapshot', async function () {
  const first = { ...this.historyLatest, name: 'Concurrent first', nodes: [...this.historyLatest.nodes].reverse() };
  const second = { ...this.historyLatest, name: 'Concurrent second', nodes: this.historyFirst.nodes };
  const results = await repository(this.page, 'concurrentSave', first, second, this.historyLatestOid);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find(result => result.status === 'rejected').message, /changed in another tab/);
  const succeeded = results.find(result => result.status === 'fulfilled').value.document;
  const persisted = await repository(this.page, 'inspect', this.historyFirst.id);
  assert.deepEqual(JSON.parse(persisted.working), content(succeeded));
  assert.equal(persisted.versions.length, 3);
  assert.deepEqual(persisted.status, [['workflow.json', 1, 1, 1]]);
  assert.deepEqual(persisted.versions[0].parent, [this.historyLatestOid]);
  assert.deepEqual(await repository(this.page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('the first workflow edit has an empty baseline for undo', async function () {
  const page = this.page;
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await expect(workflowNameInput(page)).toHaveValue('Untitled workflow');
  await expect(workflowNameInput(page)).toBeFocused();
  await closeWorkflowDetails(page);
  await expect(workflow(page).locator('.svelte-flow__node')).toHaveCount(0);
  await workflow(page).getByRole('button', { name: 'Cast', exact: true }).click();
  await saved(page);
  const created = (await storedWorkflows(page)).find(document => document.name === 'Untitled workflow');
  assert.ok(created);
  const versions = await repository(page, 'history', created.id);
  assert.equal(versions.length, 2);
  assert.deepEqual((await repository(page, 'readVersion', created.id, versions.at(-1).oid)).nodes, []);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(workflow(page).locator('.svelte-flow__node')).toHaveCount(0);
  await saved(page);
  await page.reload();
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(workflow(page).locator('.svelte-flow__node-cast')).toHaveCount(1);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('a committed workflow survives an interrupted catalogue update without a duplicate commit', async function () {
  const latest = { ...this.historyLatest, name: 'Recovered after interruption' };
  const failure = await repository(this.page, 'interruptCatalogFinish', latest, this.historyLatestOid);
  assert.match(failure, /Interrupted catalogue update after Git commit/);
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await expectWorkflowName(this.page, latest.name);
  const recovered = await repository(this.page, 'inspect', latest.id);
  assert.deepEqual(JSON.parse(recovered.working), content(latest));
  assert.equal(recovered.entry.name, latest.name);
  assert.equal(recovered.versions.length, 3);
  assert.deepEqual(recovered.versions[0].parent, [this.historyLatestOid]);
  assert.deepEqual(recovered.status, [['workflow.json', 1, 1, 1]]);
  await this.page.reload();
  assert.equal((await repository(this.page, 'history', latest.id)).length, 3);
  assert.deepEqual(await repository(this.page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('an interrupted {string} recovers the selected version and exact Git references', async function (operation) {
  const page = this.page;
  let selected = this.historyLatestOid;
  if (operation !== 'undo') {
    await repository(page, 'undo', this.historyFirst.id, selected);
    selected = this.historyFirstOid;
  }
  const failure = operation === 'fork'
    ? await repository(page, 'interruptCatalogFinish', { ...this.historyFirst, name: 'Recovered alternate future' }, selected)
    : await repository(page, 'interruptCatalogFinish', this.historyFirst.id, selected, operation);
  assert.match(failure, /Interrupted catalogue update after Git commit/);
  const interrupted = await repository(page, 'inspectGraph', this.historyFirst.id);
  assert.ok(interrupted.pending, 'The recovery journal survives failed finalization.');
  const expected = operation === 'undo' ? this.historyFirst : operation === 'redo' ? this.historyLatest
    : { ...this.historyFirst, name: 'Recovered alternate future' };
  assertGraph(interrupted, operation === 'fork' ? interrupted.head : operation === 'undo' ? this.historyFirstOid : this.historyLatestOid,
    operation === 'fork' ? { main: interrupted.head, 'stash-1': this.historyLatestOid } : { main: interrupted.head },
    operation === 'fork' ? 3 : 2);
  assert.deepEqual(graphContent(interrupted), content(expected));
  if (operation === 'fork') await repository(page, 'dropWorkingFile', this.historyFirst.id);
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await setMode(page, 'workflow');
    await expectWorkflowName(page, expected.name);
    const recovered = await repository(page, 'inspectGraph', this.historyFirst.id);
    assert.equal(recovered.pending, undefined);
    for (const key of ['head', 'headRef', 'branches', 'redo', 'commits', 'working'])
      assert.deepEqual(recovered[key], interrupted[key], `${key} survives ${reload ? 'a second reload' : 'recovery'}.`);
    const loaded = await repository(page, 'load', this.historyFirst.id);
    assert.equal(loaded.revision, interrupted.head);
    assert.equal(loaded.canRedo, operation === 'undo');
    const inspected = await repository(page, 'inspect', this.historyFirst.id);
    assert.equal(inspected.entry.name, expected.name);
    assert.deepEqual(inspected.status, [['workflow.json', 1, 1, 1]]);
  }
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('quick structural edits create separate workflow commits', async function () {
  const page = this.page;
  await repository(page, 'holdWrites', this.historyFirst.id);
  try {
    await workflow(page).getByRole('button', { name: 'Cast', exact: true }).click();
    await expect(page.locator('.site-header .document-meta')).toHaveText('Saving…');
    await workflow(page).getByRole('button', { name: 'Cast', exact: true }).click();
  } finally { await repository(page, 'releaseWrites'); }
  await expect.poll(async () => (await repository(page, 'history', this.historyFirst.id)).length).toBe(4);
  await saved(page);
  const graph = await repository(page, 'inspect', this.historyFirst.id);
  assert.deepEqual(graph.versions.map(version => JSON.parse(version.text).nodes.length), [4, 3, 2, 1]);
  assert.deepEqual(graph.versions[0].parent, [graph.versions[1].oid]);
  assert.deepEqual(graph.versions[1].parent, [this.historyLatestOid]);
});

Then('returning to the original text while saving preserves both completed edits', async function () {
  const page = this.page;
  await repository(page, 'holdWrites', this.historyFirst.id);
  try {
    await renameWorkflow(page, 'Temporary queued name');
    await expect(page.locator('.site-header .document-meta')).toHaveText('Saving…');
    await renameWorkflow(page, this.historyLatest.name);
  } finally { await repository(page, 'releaseWrites'); }
  await expect.poll(async () => (await repository(page, 'history', this.historyFirst.id)).length).toBe(6);
  await saved(page);
  const graph = await repository(page, 'inspect', this.historyFirst.id);
  assert.deepEqual(graph.versions.slice(0, 3).map(version => JSON.parse(version.text).name),
    [this.historyLatest.name, 'Temporary queued name', this.historyLatest.name]);
  assert.deepEqual(graph.versions[0].parent, [graph.versions[1].oid]);
});

Then('a paused text edit and a paused node drag each create only one completed version', async function () {
  const page = this.page;
  await openWorkflowDetails(page);
  await workflowNameInput(page).fill('A paused');
  await page.waitForTimeout(650);
  assert.equal((await repository(page, 'history', this.historyFirst.id)).length, 6, 'Typing remains one unfinished edit across a pause.');
  await workflowNameInput(page).pressSequentially(' text edit');
  await page.waitForTimeout(650);
  assert.equal((await repository(page, 'history', this.historyFirst.id)).length, 6);
  await closeWorkflowDetails(page);
  await expect.poll(async () => (await repository(page, 'history', this.historyFirst.id)).length).toBe(7);
  await saved(page);
  const typed = await repository(page, 'load', this.historyFirst.id);
  assert.equal(typed.document.name, 'A paused text edit');
  await workflow(page).getByRole('button', { name: 'Fit View', exact: true }).click();
  const node = workflow(page).locator(`[data-id="${this.historyFirst.nodes[0].id}"]`);
  const box = await node.boundingBox();
  assert.ok(box);
  const start = { x: box.x + box.width / 2, y: box.y + 20 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 35, start.y + 30, { steps: 5 });
    await page.waitForTimeout(650);
    assert.equal((await repository(page, 'history', this.historyFirst.id)).length, 7, 'A paused drag remains one unfinished edit.');
    await page.mouse.move(start.x + 85, start.y + 65, { steps: 5 });
  } finally { await page.mouse.up(); }
  await expect.poll(async () => (await repository(page, 'history', this.historyFirst.id)).length).toBe(8);
  await saved(page);
  const moved = await repository(page, 'load', this.historyFirst.id);
  assert.notDeepEqual(moved.document.nodes.find(node => node.id === this.historyFirst.nodes[0].id).position, this.historyFirst.nodes[0].position);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('existing localStorage workflows migrate once and retain their identifiers', async function () {
  const legacy = document('legacy-migration', 'Existing browser workflow');
  await this.page.evaluate(({ key, legacy }) => localStorage.setItem(key, JSON.stringify([legacy])), { key: storageKey, legacy });
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await expect.poll(() => this.page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(null);
  const imported = await repository(this.page, 'load', legacy.id);
  assert.deepEqual(imported.document, legacy);
  assert.equal((await repository(this.page, 'history', legacy.id)).length, 1);
  await this.page.evaluate(({ key, legacy }) => localStorage.setItem(key, JSON.stringify([legacy])), { key: storageKey, legacy });
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await expect.poll(() => this.page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(null);
  assert.equal((await repository(this.page, 'history', legacy.id)).length, 1);
  assert.equal((await storedWorkflows(this.page)).length, 3);
  assert.deepEqual(await repository(this.page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});

Then('an interrupted append-only Undo migrates to real commit navigation', async function () {
  const page = this.page;
  const legacy = await repository(page, 'legacyPendingUndo', this.historyFirst.id, this.historyFirstOid, this.historyLatestOid);
  const before = await repository(page, 'inspectGraph', this.historyFirst.id);
  assert.equal('operation' in before.pending, false);
  assert.equal('format' in before.navigation, false);
  assert.deepEqual(graphCommit(before, legacy).parent, [this.historyLatestOid]);
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await setMode(page, 'workflow');
    await expectWorkflowName(page, this.historyFirst.name);
    const migrated = await repository(page, 'inspectGraph', this.historyFirst.id);
    assertGraph(migrated, legacy, { main: legacy }, 3);
    assert.deepEqual(migrated.commits, before.commits);
    assert.equal(migrated.pending, undefined);
    assert.equal(migrated.navigation.format, 2);
    assert.equal(migrated.redo, null);
    assert.equal((await repository(page, 'load', this.historyFirst.id)).canRedo, false);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectWorkflowName(page, this.historyLatest.name);
  await saved(page);
  assert.equal((await repository(page, 'load', this.historyFirst.id)).revision, this.historyLatestOid);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectWorkflowName(page, this.historyFirst.name);
  await saved(page);
  const redone = await repository(page, 'inspectGraph', this.historyFirst.id);
  assertGraph(redone, legacy, { main: legacy }, 3);
  assert.deepEqual(redone.commits, before.commits);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.historyOtherBefore);
});
