// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const enterprise = '/enterprises/{enterprise}';
const configurations = enterprise + '/code-security/configurations';
const spaces = '/users/{username}/copilot-spaces';
const space = spaces + '/{space_number}';
const collaborators = space + '/collaborators';
const collaborator = collaborators + '/{actor_type}/{actor_identifier}';
const resources = space + '/resources';
const resource = resources + '/{space_resource_id}';
const row = (id, method, path, scope, body) => ({ id, method, path, scope, body });
export const githubClassicCases = [
  row('code-security/get-configurations-for-enterprise', 'GET', configurations, 'read:enterprise'),
  row('code-security/create-configuration-for-enterprise', 'POST', configurations, 'admin:enterprise', { name: 'Fixture configuration' }),
  row('code-security/get-default-configurations-for-enterprise', 'GET', configurations + '/defaults', 'read:enterprise'),
  row('code-security/get-single-configuration-for-enterprise', 'GET', configurations + '/{configuration_id}', 'read:enterprise'),
  row('code-security/update-enterprise-configuration', 'PATCH', configurations + '/{configuration_id}', 'admin:enterprise', { name: 'Updated fixture configuration' }),
  row('code-security/delete-configuration-for-enterprise', 'DELETE', configurations + '/{configuration_id}', 'admin:enterprise'),
  row('code-security/attach-enterprise-configuration', 'POST', configurations + '/{configuration_id}/attach', 'admin:enterprise', { scope: 'all_without_configurations' }),
  row('code-security/set-configuration-as-default-for-enterprise', 'PUT', configurations + '/{configuration_id}/defaults', 'admin:enterprise', { default_for_new_repos: 'private_and_internal' }),
  row('code-security/get-repositories-for-enterprise-configuration', 'GET', configurations + '/{configuration_id}/repositories', 'read:enterprise'),
  row('copilot/set-enterprise-coding-agent-policy', 'PUT', enterprise + '/copilot/policies/coding_agent', 'manage_billing:copilot or admin:enterprise', { policy_state: 'enabled_for_selected_orgs' }),
  row('copilot/add-organizations-to-enterprise-coding-agent-policy', 'POST', enterprise + '/copilot/policies/coding_agent/organizations', 'manage_billing:copilot or admin:enterprise', { organizations: ['fixture-organization'] }),
  row('copilot/remove-organizations-from-enterprise-coding-agent-policy', 'DELETE', enterprise + '/copilot/policies/coding_agent/organizations', 'manage_billing:copilot or admin:enterprise', { organizations: ['fixture-organization'] }),
  row('dependabot/list-alerts-for-enterprise', 'GET', enterprise + '/dependabot/alerts', 'repo or security_events'),
  row('copilot-spaces/list-for-user', 'GET', spaces, 'read:user'),
  row('copilot-spaces/create-for-user', 'POST', spaces, 'read:user', { name: 'Fixture space', base_role: 'no_access' }),
  row('copilot-spaces/get-for-user', 'GET', space, 'repo'),
  row('copilot-spaces/update-for-user', 'PUT', space, 'read:user', { name: 'Updated fixture space' }),
  row('copilot-spaces/delete-for-user', 'DELETE', space, 'user'),
  row('copilot-spaces/list-collaborators-for-user', 'GET', collaborators, 'user'),
  row('copilot-spaces/add-collaborator-for-user', 'POST', collaborators, 'user', { actor_type: 'User', actor_identifier: 'fixture-collaborator', role: 'writer' }),
  row('copilot-spaces/update-collaborator-for-user', 'PUT', collaborator, 'user', { role: 'reader' }),
  row('copilot-spaces/remove-collaborator-for-user', 'DELETE', collaborator, 'user'),
  row('copilot-spaces/list-resources-for-user', 'GET', resources, 'read:user'),
  row('copilot-spaces/create-resource-for-user', 'POST', resources, 'write:user', { resource_type: 'free_text', metadata: { name: 'notes.txt', text: 'Fixture resource text' } }),
  row('copilot-spaces/get-resource-for-user', 'GET', resource, 'read:user'),
  row('copilot-spaces/update-resource-for-user', 'PUT', resource, 'write:user', { metadata: { name: 'updated-notes.txt', text: 'Updated fixture resource text' } }),
  row('copilot-spaces/delete-resource-for-user', 'DELETE', resource, 'write:user'),
];

const parameters = { enterprise: 'fixture-enterprise', configuration_id: '42', username: 'fixture-user',
  space_number: '43', space_resource_id: '44', actor_type: 'User', actor_identifier: 'fixture-collaborator' };
export function githubClassicRequest(test) {
  const values = {};
  const path = test.path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(parameters, name)) throw Error('Missing fixture path parameter ' + name);
    values['path:' + name] = parameters[name];
    return encodeURIComponent(parameters[name]);
  });
  for (const [name, value] of Object.entries(test.body ?? {}))
    values['body:' + name] = typeof value === 'string' ? value : JSON.stringify(value);
  return { values, url: 'https://api.github.com' + path };
}
