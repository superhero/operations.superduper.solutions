// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { After, Before, Then } from '@cucumber/cucumber';
import { operationResourcePath, operationNavigation, operationResourceGroups, navigationOperations, operationCategoryPaths } from './lib/operation-navigation.ts';
import { updateOperationVersion } from './lib/workflow-operation-version.ts';
import { createOperationGraph, removeGraphSelection } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { updateCatalogs, extractOperations } from './lib/catalog.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { versionedSchema } from '../tests/fixtures/operation-versions.mjs';
import { categoryLabel } from './lib/category-label.ts';

Before({ tags: '@operation-navigation' }, function () { this.previousCatalogs = catalogs; });
After({ tags: '@operation-navigation' }, function () { updateCatalogs(this.previousCatalogs); });

const descriptor = (id, path, extra = {}) => ({ id, path, method: 'GET', ...extra });
const ids = group => [...(group.operationIds ?? []), ...(group.children ?? []).flatMap(ids)];
const document = graph => ({ version: 3, id: 'versioned', name: 'Versioned workflow', ...graph,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: true, dashed: false });
const field = (nodes, ownerId, direction, label) => {
  const node = nodes.find(node => node.type === 'data' && node.data.ownerId === ownerId &&
    node.data.direction === direction && node.data.fields.some(field => field.label === label));
  assert.ok(node, `${ownerId} has a ${direction} field named ${label}`);
  return { node, field: node.data.fields.find(field => field.label === label) };
};
const mapping = (id, source, target) => ({ id, kind: 'mapping', source: source.node.id, sourceHandle: source.field.id,
  target: target.node.id, targetHandle: target.field.id });

Then('URL resource categories preserve templates queries and non-version resource names', () => {
  for (const version of ['v1', 'v2', 'V3', 'version1', 'version-2', 'ver_3', 'v1.2', 'v1beta2', 'v2026-10-20']) {
    assert.deepEqual(operationResourcePath(`/${version}/foo/{id}/bar/`), {
      resources: ['foo', 'bar'], endpoint: '/foo/{id}/bar/', version,
    });
  }
  assert.deepEqual(operationResourcePath('/v1/foo/{id}/bar?beta=true'), {
    resources: ['foo', 'bar'], endpoint: '/foo/{id}/bar?beta=true', version: 'v1',
  });
  assert.deepEqual(operationResourcePath('/foo/v2/bar/version-3'), {
    resources: ['foo', 'bar'], endpoint: '/foo/bar', version: 'v2 / version-3',
  });
  assert.deepEqual(operationResourcePath('/'), { resources: [], endpoint: '/', version: 'Default' });
  assert.deepEqual(operationResourcePath('/{id}'), { resources: [], endpoint: '/{id}', version: 'Default' });
  assert.deepEqual(operationResourcePath('/v1'), { resources: [], endpoint: '/', version: 'v1' });
  assert.deepEqual(operationResourcePath('/v1/foo//bar/'), { resources: ['foo', 'bar'], endpoint: '/foo//bar/', version: 'v1' });
  assert.deepEqual(operationResourcePath('/versions/v1foo/foo-{id}/2026-10-20'), {
    resources: ['versions', 'v1foo', 'foo-{id}', '2026-10-20'], endpoint: '/versions/v1foo/foo-{id}/2026-10-20', version: 'Default',
  });
});

Then('transport path categories skip generic segments without changing endpoint identity', () => {
  for (const segment of ['api', 'API', 'Api', 'rest', 'REST', 'rEsT', '0', '3', '003', '2026']) {
    const path = `/projects/${segment}/issues/{id}/comments`;
    assert.deepEqual(operationResourcePath(path), {
      resources: ['projects', 'issues', 'comments'], endpoint: path, version: 'Default',
    });
  }
  assert.deepEqual(operationResourcePath('/REST/aPi/3/issues/{id}/v2/007/comments?route=/api/9'), {
    resources: ['issues', 'comments'], endpoint: '/REST/aPi/3/issues/{id}/007/comments?route=/api/9', version: 'v2',
  });
  assert.deepEqual(operationResourcePath('/rest/api/3'), {
    resources: [], endpoint: '/rest/api/3', version: 'Default',
  });
  const meaningful = '/api_keys/restful/3d/2fa/2026-10-20';
  assert.deepEqual(operationResourcePath(meaningful), {
    resources: ['api_keys', 'restful', '3d', '2fa', '2026-10-20'], endpoint: meaningful, version: 'Default',
  });
});

Then('flattened transport paths retain every operation and distinct endpoint family', () => {
  const operations = [descriptor('jira:root3', '/rest/api/3'), descriptor('jira:root2', '/rest/api/2'),
    descriptor('jira:read3', '/rest/api/3/issue/{key}'), descriptor('jira:read2', '/rest/api/2/issue/{key}'),
    descriptor('jira:plain', '/issue/{key}'), descriptor('jira:comments1', '/rest/api/3/v1/issue/{key}/comments'),
    descriptor('jira:comments2', '/rest/api/3/v2/issue/{key}/comments')];
  const groups = [{ id: 'jira', name: 'Jira', description: '', children: [
    { id: 'jira:tag:Issues', name: 'Issues', description: '', operationIds: operations.map(operation => operation.id) },
  ] }];
  const original = structuredClone({ groups, operations });
  const navigation = operationNavigation(operations);
  const tree = operationResourceGroups(groups, navigation);
  const issues = tree[0].children[0];
  assert.equal(issues.name, 'Issues');
  assert.deepEqual(issues.operationIds, ['jira:root3', 'jira:root2'], 'Prefix-only operations appear at their parent.');
  assert.deepEqual(issues.children.map(child => child.name), ['issue']);
  const issue = issues.children[0];
  assert.deepEqual(navigationOperations(issue.operationIds, navigation, null).map(operation => operation.id),
    ['jira:read3', 'jira:read2', 'jira:plain'], 'Different concrete endpoints remain independently selectable.');
  assert.deepEqual(issue.children.map(child => child.name), ['comments']);
  const comments = issue.children[0];
  assert.deepEqual(comments.operationIds, ['jira:comments1', 'jira:comments2']);
  assert.deepEqual(navigationOperations(comments.operationIds, navigation, null).map(operation => operation.id), ['jira:comments1']);
  assert.deepEqual(navigationOperations(comments.operationIds, navigation, new Map([['jira:comments2', 0]]))
    .map(operation => operation.id), ['jira:comments2'], 'Search can still choose another API version.');
  assert.deepEqual(tree.flatMap(ids).sort(), operations.map(operation => operation.id).sort(), 'Every operation remains reachable.');
  const paths = operationCategoryPaths(tree);
  assert.deepEqual(paths.get('jira:root3'), ['Jira', 'Issues']);
  assert.deepEqual(paths.get('jira:comments1'), ['Jira', 'Issues', 'Issue', 'Comments']);
  assert.deepEqual({ groups, operations }, original, 'Source URLs and catalog metadata stay intact.');
});

Then('operation resource groups are stable nested trees without mutating their sources', () => {
  const operations = [descriptor('api:foo', '/v1/foo'), descriptor('api:bar', '/v2/foo/{id}/bar'),
    descriptor('api:second', '/version-3/foo/{id}/bar'), descriptor('api:root', '/{id}'), descriptor('api:other', '/other')];
  const groups = [{ id: 'api', name: 'API', description: 'Source', children: [
    { id: 'api:tag:Operations', name: 'Operations', description: '', operationIds: operations.slice(0, 4).map(operation => operation.id) },
    { id: 'authored', name: 'Authored / title', description: '', operationIds: ['api:other', 'missing'], children: [] },
  ] }, { id: 'empty', name: 'Empty', description: '' }];
  const original = structuredClone(groups);
  const navigation = operationNavigation(operations);
  const result = operationResourceGroups(groups, navigation);
  assert.deepEqual(groups, original);
  assert.equal(result[0].description, 'Source');
  assert.deepEqual(result[0].operationIds, ['api:root']);
  assert.equal(result[0].children[0].name, 'Authored / title');
  const foo = result[0].children[1];
  assert.equal(foo.name, 'foo');
  assert.deepEqual(foo.operationIds, ['api:foo']);
  assert.equal(foo.children[0].name, 'bar');
  assert.deepEqual(foo.children[0].operationIds, ['api:bar', 'api:second']);
  assert.deepEqual(result.flatMap(ids).sort(), operations.map(operation => operation.id).sort());
  assert.deepEqual(operationResourceGroups(groups, navigation), result);
  assert.deepEqual(operationResourceGroups([], navigation), []);
  assert.equal(result[1].children.length, 0);
  const paths = operationCategoryPaths(result);
  assert.deepEqual(paths.get('api:foo'), ['API', 'Foo']);
  assert.deepEqual(paths.get('api:bar'), ['API', 'Foo', 'Bar']);
  assert.deepEqual(paths.get('api:other'), ['API', 'Authored / Title', 'Other']);
  assert.equal(paths.get('missing'), undefined);
  for (const [source, expected] of [['memory_stores', 'Memory Stores'], ['deployment_runs', 'Deployment Runs'],
    ['user_profiles', 'User Profiles'], ['api_keys', 'API Keys'], ['HTTP API', 'HTTP API'],
    ['oauth_clients', 'OAuth Clients'], ['OpenAI SDK', 'OpenAI SDK'], ['GraphQL / v1 / files', 'GraphQL / v1 / Files']]) {
    assert.equal(categoryLabel(source), expected);
  }
  assert.deepEqual(operationCategoryPaths([{ id: 'raw_category', name: 'memory_stores', description: '', operationIds: ['operation_id'] }])
    .get('operation_id'), ['Memory Stores']);
});

Then('generic Operations tags disappear while literal schema and resource names remain', () => {
  const operations = [descriptor('api:direct', '/v2/foo'), descriptor('api:untagged', '/v1/foo'),
    descriptor('api:root', '/v1'), descriptor('api:literal', '/Operations'),
    descriptor('api:tagged', '/foo'), descriptor('api:nested', '/nested'), descriptor('other:read', '/entry')];
  const generic = (id, operationIds, children = []) => ({ id: `${id}:tag:Operations`, name: 'Operations',
    description: '', operationIds, children });
  const groups = [{ id: 'api', name: 'Operations', description: 'A real schema name', operationIds: ['api:direct'], children: [
    generic('api', ['api:untagged', 'api:root', 'api:literal']),
    { id: 'api:empty:tag:Operations', name: 'Operations', description: '' },
    { id: 'api:tag:Accounts', name: 'Accounts', description: 'Authored category', operationIds: ['api:tagged'],
      children: [generic('api:nested', ['api:nested'])] },
    { id: 'other', name: 'Operations', description: 'Another schema', children: [generic('other', ['other:read'])] },
  ] }];
  const original = structuredClone(groups);
  const result = operationResourceGroups(groups, operationNavigation(operations));
  const root = result[0];
  const allGroups = nodes => nodes.flatMap(node => [node, ...allGroups(node.children ?? [])]);
  assert.ok(allGroups(result).every(group => !group.id.endsWith(':tag:Operations')));
  assert.equal(root.name, 'Operations', 'A schema name is not a generic tag.');
  assert.deepEqual(root.operationIds, ['api:root'], 'Resource-free entries appear directly under the schema.');
  assert.deepEqual(root.children.find(group => group.name === 'foo').operationIds, ['api:direct', 'api:untagged'], 'Hoisted and direct entries share one resource tree.');
  assert.ok(root.children.some(group => group.name === 'Operations' && group.id.includes(':resource:')),
    'A literal URL resource keeps its name.');
  assert.equal(root.children.find(group => group.id === 'other').name, 'Operations');
  const accounts = root.children.find(group => group.name === 'Accounts');
  assert.equal(accounts.description, 'Authored category');
  assert.deepEqual(accounts.children.map(group => group.name), ['foo', 'nested']);
  assert.deepEqual(result.flatMap(ids).sort(), operations.map(operation => operation.id).sort(), 'Every concrete operation remains reachable once.');
  assert.deepEqual(groups, original, 'Canonical discovery metadata is not rewritten.');
});

Then('version families stay scoped to schema method and endpoint and respect availability and search', () => {
  const operations = [descriptor('api:v1', '/v1/foo'), descriptor('api:v2', '/v2/foo'),
    descriptor('other:v1', '/v1/foo'), descriptor('api:post', '/v1/foo', { method: 'POST' }),
    descriptor('api:parameter', '/v1/foo/{id}'), descriptor('api:query', '/v1/foo?beta=true'),
    descriptor('plain', '/foo'), descriptor('api:alias', '/v1/alias'), descriptor('api:aliasCopy', '/v1/alias'),
    descriptor('api:blocked', '/v1/guarded', { unavailableReason: 'Unsupported' }), descriptor('api:usable', '/version-2/guarded'),
    descriptor('api:onlyBlocked', '/v1/nope', { unavailableReason: 'Unsupported' }),
    descriptor('api:slash', '/v2/foo/'), descriptor('api:renamedParameter', '/v2/foo/{other}')];
  const navigation = operationNavigation(operations);
  assert.equal(operationNavigation(operations), navigation, 'Queries reuse the descriptor snapshot.');
  assert.notEqual(operationNavigation([...operations]), navigation);
  assert.deepEqual(navigation.variants.get('api:v1').map(operation => operation.id), ['api:v1', 'api:v2']);
  for (const operation of operations.slice(2, 9)) assert.deepEqual(navigation.variants.get(operation.id), [operation]);
  for (const id of ['api:slash', 'api:renamedParameter']) assert.deepEqual(navigation.variants.get(id), [navigation.byId.get(id)]);
  const all = operations.map(operation => operation.id);
  const choose = (subset = all, matching = null) => navigationOperations(subset, navigation, matching).map(operation => operation.id);
  assert.deepEqual(choose(), all.filter(id => !['api:v2', 'api:blocked'].includes(id)));
  assert.deepEqual(choose(all, new Map([['api:v2', 0]])), ['api:v2']);
  assert.deepEqual(choose(all, new Map([['api:v2', 0], ['api:v1', 1]])), ['api:v2']);
  assert.deepEqual(choose(['api:v2']), ['api:v2']);
  assert.deepEqual(choose(all, new Map()), []);
  assert.deepEqual(choose(['missing']), []);
  assert.deepEqual(choose(['api:blocked']), ['api:blocked']);
});

function versionGraph() {
  const source = versionedSchema();
  const operations = extractOperations(source, 'versioned');
  updateCatalogs([...catalogs, { id: 'versioned', name: 'Versioned', file: 'versions.json', document: source,
    groups: [], execution: { kind: 'http', origin: source.servers[0].url } }]);
  const current = createOperationGraph(operations.find(operation => operation.id === 'versioned:readV1'), { x: 500, y: 300 }, 'owner', source);
  const sink = createOperationGraph(operations.find(operation => operation.id === 'versioned:sink'), { x: 1500, y: 300 }, 'sink', source);
  const graph = { nodes: [...current.nodes, ...sink.nodes], edges: [...current.edges, ...sink.edges] };
  return { graph, source, next: operations.find(operation => operation.id === 'versioned:readV2') };
}

Then('switching a canonical operation version preserves identities and discards obsolete mappings', async () => {
  const { graph, source, next } = versionGraph();
  const bind = label => mapping(label, field(graph.nodes, 'owner', 'outputs', label), field(graph.nodes, 'sink', 'inputs', label));
  graph.edges.push(bind('same'), bind('changed'), mapping('removed', field(graph.nodes, 'owner', 'outputs', 'value'), field(graph.nodes, 'sink', 'inputs', 'removed')));
  const vault = { id: 'vault', type: 'vault', position: { x: 0, y: 0 }, data: {} };
  graph.nodes.push(vault);
  for (const label of ['keep', 'changed', 'oldOnly']) {
    const target = field(graph.nodes, 'owner', 'inputs', label);
    graph.edges.push({ id: `input-${label}`, kind: 'mapping', source: vault.id, sourceHandle: 'value', target: target.node.id, targetHandle: target.field.id });
  }
  const owner = graph.nodes.find(node => node.id === 'owner');
  owner.data.credentialBinding = { alternative: 0, credentials: {}, fingerprint: 'a'.repeat(64) };
  for (const node of graph.nodes) node.position = { x: node.position.x + 20, y: node.position.y + 7 };
  const before = structuredClone(graph);
  const changed = updateOperationVersion('owner', next, source, graph.nodes, graph.edges);
  assert.deepEqual(changed.nodes.find(node => node.id === 'owner').data.credentialBinding, owner.data.credentialBinding);
  const saved = parseWorkflowDocument(JSON.stringify(validateWorkflowDocument(document(changed))));
  assert.deepEqual(graph, before, 'Version changes never mutate the undo snapshot.');
  const updated = saved.nodes.find(node => node.id === 'owner');
  assert.equal(updated.data.operationId, 'versioned:readV2');
  assert.equal(updated.data.path, '/version-2/foo');
  assert.deepEqual(updated.position, owner.position);
  assert.equal(updated.data.credentialBinding, undefined, 'Portable imports continue to omit local credential bindings.');
  assert.deepEqual(saved.edges.filter(edge => edge.kind === 'mapping').map(edge => edge.id).sort(), ['input-keep', 'same']);
  const retained = field(saved.nodes, 'owner', 'outputs', 'same');
  assert.equal(retained.node.id, field(before.nodes, 'owner', 'outputs', 'same').node.id);
  assert.deepEqual(retained.node.position, field(before.nodes, 'owner', 'outputs', 'same').node.position);
  assert.equal(field(saved.nodes, 'owner', 'inputs', 'changed').field.type, 'Integer');
  assert.ok(!saved.nodes.some(node => node.type === 'data' && node.data.ownerId === 'owner' && node.data.fields.some(field => field.label === 'oldOnly')));
  assert.ok(field(saved.nodes, 'owner', 'inputs', 'newOnly'));
  const requests = [];
  const execution = createWorkflowRequestExecution(async (url) => { requests.push(url); return Response.json({ same: 'retained', changed: 2, added: { value: true } }); });
  // Select the changed owner as the run start; disconnected vault inputs are irrelevant to this contract check.
  const runnable = { ...saved, nodes: saved.nodes.filter(node => node.type !== 'vault'), edges: saved.edges.filter(edge => edge.id !== 'input-keep') };
  const runner = createWorkflowRunner(runnable, 'owner', execution);
  const visit = runner.next();
  assert.equal(visit.kind, 'operation');
  await runner.submit({ 'query:changed': '7' });
  assert.equal(new URL(requests[0]).pathname, '/version-2/foo');
  assert.equal(new URL(requests[0]).searchParams.get('changed'), '7');
});

Then('version replacements preserve hidden branches control links and legacy operation nodes', () => {
  const { graph, source, next } = versionGraph();
  const owner = graph.nodes.find(node => node.id === 'owner');
  delete owner.type;
  const body = field(graph.nodes, 'owner', 'outputs', 'same').node;
  const closed = removeGraphSelection({ nodes: [{ id: body.id }], edges: [] }, graph.nodes, graph.edges);
  const changed = updateOperationVersion('owner', next, source, closed.nodes, closed.edges);
  validateWorkflowDocument(document(changed));
  assert.equal(changed.nodes.find(node => node.id === 'owner').type, 'operation');
  assert.equal(changed.nodes.find(node => node.id === body.id).hidden, true);
  assert.equal(field(changed.nodes, 'owner', 'outputs', 'value').node.hidden, true, 'New descendants stay in their closed branch.');
  assert.equal(changed.edges.find(edge => edge.id === `schema:${body.id}`).detached, true);
  assert.ok(changed.edges.filter(edge => edge.kind === 'schema' && (changed.nodes.find(node => node.id === edge.source).hidden || changed.nodes.find(node => node.id === edge.target).hidden)).every(edge => edge.hidden));
  const legacy = { nodes: graph.nodes.filter(node => node.type === undefined || node.type === 'operation'),
    edges: [{ id: 'control', source: 'owner', target: 'sink' }] };
  validateWorkflowDocument(document(legacy));
  const updatedLegacy = updateOperationVersion('owner', next, source, legacy.nodes, legacy.edges);
  validateWorkflowDocument(document(updatedLegacy));
  assert.equal(updatedLegacy.nodes.length, 2);
  assert.deepEqual(updatedLegacy.edges, legacy.edges);
  assert.equal(updatedLegacy.nodes[0].data.path, '/version-2/foo');
  const incoming = [{ id: 'incoming', source: 'sink', target: 'owner' }];
  const updatedIncoming = updateOperationVersion('owner', next, source, legacy.nodes, incoming);
  validateWorkflowDocument(document(updatedIncoming));
  assert.deepEqual(updatedIncoming.edges, incoming, 'Incoming legacy ordering is retained too.');
  const visible = updateOperationVersion('owner', next, source, graph.nodes, graph.edges);
  assert.equal(visible.nodes.find(node => node.id === 'owner').data.credentialBinding, undefined);
  for (const id of ['absent', body.id]) assert.deepEqual(updateOperationVersion(id, next, source, graph.nodes, graph.edges), graph);
});
