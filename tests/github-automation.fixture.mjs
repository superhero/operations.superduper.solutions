// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const repo = '/agents/repos/{owner}/{repo}/automations';
const item = repo + '/{automation_id}';
const user = ['personal', 'app-user', 'classic-user'];
const all = ['personal', 'app-user', 'installation', 'classic-user'];
const row = (id, method, path, wirePath, profiles) => ({ id: 'agent-automations/' + id, method, path, wirePath, profiles });
export const githubAutomationCases = [
  row('list-automations', 'GET', '/agents/automations', '/agents/automations', user),
  row('list-repo-automations', 'GET', repo, repo, all),
  row('create-repo-automation', 'POST', repo, repo, all),
  row('get-repo-automation', 'GET', item, item, all),
  row('get-automation', 'GET', '/agents/automations/{automation_id}', item, all),
  row('edit-repo-automation', 'PATCH', item, item, all),
  row('delete-repo-automation', 'DELETE', item, item, all),
  row('list-available-automation-tools', 'GET', '/agents/automations/available-tools', repo + '/available-tools', all),
  row('list-available-automation-triggers', 'GET', '/agents/automations/available-triggers', repo + '/available-triggers', all),
  row('list-automation-tasks', 'GET', '/agents/automations/{automation_id}/tasks', item + '/tasks', ['personal', 'app-user', 'installation']),
];
export function githubAutomationRequest(test, profile, operation) {
  const parameters = { owner: 'fixture-owner', repo: 'fixture-repo', automation_id: '00000000-0000-4000-8000-000000000042' };
  const values = {};
  const path = test.wirePath.replace(/\{([^}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(parameters, name)) throw Error('Missing automation fixture path input ' + name);
    values['path:' + name] = parameters[name]; return parameters[name];
  });
  const body = test.method === 'POST' ? { name: 'Fixture automation', prompt: 'Summarize fixture issues',
    type: profile === 'installation' ? 'shared' : 'personal', continuous_history: true,
    triggers: { issue_opened: { query: 'is:issue' } }, tools: ['github/issue_read'] }
    : test.method === 'PATCH' ? { name: 'Updated fixture automation', enabled: false, continuous_history: false } : undefined;
  if (body) {
    if (operation.bodyValue) values['body:$'] = JSON.stringify(body);
    else for (const [key, value] of Object.entries(body)) values['body:' + key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  const query = test.id.endsWith('/list-automations') || test.id.endsWith('/list-repo-automations')
    ? '?type=' + (profile === 'installation' ? 'shared' : 'personal') : '';
  if (query) values['query:type'] = profile === 'installation' ? 'shared' : 'personal';
  return { values, body, url: 'https://api.github.com' + path + query };
}
