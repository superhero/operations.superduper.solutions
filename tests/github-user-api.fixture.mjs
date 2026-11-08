// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const row = (id, method, path, profiles, body, status = body ? 201 : method === 'DELETE' ? 204 : 200, root = false) =>
  ({ id, method, path, profiles, body, status, root });
const fineUser = ['personal', 'app-user'];
const classic = ['classic-user'];
const tasks = '/agents/repos/{owner}/{repo}/tasks';
const projects = '/users/{username}/projectsV2';
const project = projects + '/{project_number}';
export const githubUserApiCases = [
  row('agent-tasks/list-tasks-for-repo', 'GET', tasks, fineUser),
  row('agent-tasks/create-task-in-repo', 'POST', tasks, fineUser, { prompt: 'Review fixture changes', base_ref: 'main', create_pull_request: false }),
  row('agent-tasks/get-task-by-repo-and-id', 'GET', tasks + '/{task_id}', fineUser),
  row('agent-tasks/list-tasks', 'GET', '/agents/tasks', fineUser),
  row('agent-tasks/get-task-by-id', 'GET', '/agents/tasks/{task_id}', fineUser),
  ...[['org', '/orgs/{org}/migrations'], ['authenticated-user', '/user/migrations']].flatMap(([suffix, path]) => [
    row('migrations/list-for-' + suffix, 'GET', path, classic),
    row('migrations/start-for-' + suffix, 'POST', path, classic,
      { repositories: ['fixture-owner/fixture-repo'], lock_repositories: false, exclude_attachments: true }),
    row('migrations/get-status-for-' + suffix, 'GET', path + '/{migration_id}', classic),
    row('migrations/delete-archive-for-' + suffix, 'DELETE', path + '/{migration_id}/archive', classic),
    row('migrations/unlock-repo-for-' + suffix, 'DELETE', path + '/{migration_id}/repos/{repo_name}/lock', classic),
    row('migrations/list-repos-for-' + suffix, 'GET', path + '/{migration_id}/repositories', classic),
  ]),
  row('projects/create-draft-item-for-authenticated-user', 'POST', '/user/{user_id}/projectsV2/{project_number}/drafts', classic, { title: 'Fixture draft', body: 'Fixture draft body' }),
  row('projects/create-view-for-user', 'POST', '/users/{user_id}/projectsV2/{project_number}/views', classic, { name: 'Fixture board', layout: 'board', filter: 'is:open' }),
  row('projects/list-for-user', 'GET', projects, classic),
  row('projects/get-for-user', 'GET', project, classic),
  row('projects/list-fields-for-user', 'GET', project + '/fields', classic),
  row('projects/add-field-for-user', 'POST', project + '/fields', classic, { name: 'Fixture text field', data_type: 'text' }, 201, true),
  row('projects/get-field-for-user', 'GET', project + '/fields/{field_id}', classic),
  row('projects/list-items-for-user', 'GET', project + '/items', classic),
  row('projects/add-item-for-user', 'POST', project + '/items', classic, { type: 'Issue', id: 41 }, 201, true),
  row('projects/get-user-item', 'GET', project + '/items/{item_id}', classic),
  row('projects/update-item-for-user', 'PATCH', project + '/items/{item_id}', classic, { fields: [{ id: 42, value: 'Fixture field value' }, { id: 43, value: null }] }, 200),
  row('projects/delete-item-for-user', 'DELETE', project + '/items/{item_id}', classic),
  row('projects/list-view-items-for-user', 'GET', project + '/views/{view_number}/items', classic),
];

const parameters = { owner: 'fixture-owner', repo: 'fixture-repo', org: 'fixture-org', username: 'fixture-user',
  repo_name: 'fixture-repo', migration_id: '42', user_id: '43', project_number: '44', field_id: '45',
  item_id: '46', view_number: '47', task_id: '00000000-0000-4000-8000-000000000042' };
export function githubUserApiRequest(test) {
  const values = {};
  const path = test.path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(parameters, name)) throw Error('Missing fixture path parameter ' + name);
    values['path:' + name] = parameters[name];
    return encodeURIComponent(parameters[name]);
  });
  if (test.root) values['body:$'] = JSON.stringify(test.body);
  else for (const [name, value] of Object.entries(test.body ?? {}))
    values['body:' + name] = typeof value === 'string' ? value : JSON.stringify(value);
  return { values, url: 'https://api.github.com' + path };
}
