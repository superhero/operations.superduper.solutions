// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createJiraCompanion } from '../companions/jira/host.mjs';
import { memoryJiraStore } from '../companions/jira/store.mjs';

export const jiraCanaries = { clientSecret: 'jira_client_secret_private_canary_5729', accessKey: 'JIRA_PAIRING_PRIVATE_5729_'.padEnd(43, 'a'),
  accessPrefix: 'jira_access_private_canary_5729_', refreshPrefix: 'jira_refresh_private_canary_5729_', code: 'jira_authorization_code_private_5729' };
export const jiraSites = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Operations Jira', url: 'https://operations-test.atlassian.net', scopes: ['read:jira-user'] },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Other Jira', url: 'https://other-test.atlassian.net', scopes: ['read:jira-user'] },
];
export const jiraAccountId = 'account:operations-user-5729';
export async function jiraHostFixture(options = {}) {
  let time = Date.now(), counter = 0;
  const fixture = { now: () => time, advance: ms => { time += ms; }, accountId: jiraAccountId, providerCalls: [], hostRequests: [], hostReplies: [],
    failRefresh: false, failAfterRefresh: false, wrongScope: false, missingRefresh: false, echo: false, resourceStatus: 200,
    sites: structuredClone(jiraSites), store: options.store ?? memoryJiraStore(),
    config: { publicOrigin: options.publicOrigin ?? 'https://jira-companion.test', hostId: options.hostId ?? randomUUID(), clientId: 'jira-public-client-id-5729',
      clientSecret: jiraCanaries.clientSecret, accessKey: jiraCanaries.accessKey, operationsOrigins: [options.applicationOrigin ?? 'https://operations.test'] } };
  const issued = new Set();
  fixture.provider = async (address, init) => {
    const url = new URL(address), headers = new Headers(init.headers);
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
    fixture.providerCalls.push({ address, method: init.method, headers, body: init.body });
    if (address === 'https://auth.atlassian.com/oauth/token') {
      assert.equal(init.method, 'POST'); assert.equal(headers.get('Content-Type'), 'application/json');
      const body = JSON.parse(init.body); assert.equal(body.client_id, fixture.config.clientId); assert.equal(body.client_secret, jiraCanaries.clientSecret);
      if (body.grant_type === 'authorization_code') {
        assert.equal(body.code, jiraCanaries.code); assert.equal(body.redirect_uri, fixture.config.publicOrigin + '/oauth/jira/callback');
        assert.deepEqual(Object.keys(body).sort(), ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri']);
      } else {
        assert.equal(body.grant_type, 'refresh_token'); assert.equal(body.refresh_token, fixture.refreshToken);
        assert.deepEqual(Object.keys(body).sort(), ['client_id', 'client_secret', 'grant_type', 'refresh_token']);
        if (fixture.failRefresh) return Response.json({ error: 'invalid_grant', error_description: jiraCanaries.clientSecret }, { status: 403 });
      }
      const token = ++counter; fixture.accessToken = jiraCanaries.accessPrefix + token; fixture.refreshToken = jiraCanaries.refreshPrefix + token; issued.add(fixture.accessToken);
      if (fixture.failAfterRefresh && body.grant_type === 'refresh_token') throw new Error('Lost token response ' + fixture.refreshToken);
      return Response.json({ access_token: fixture.accessToken, ...(fixture.missingRefresh ? {} : { refresh_token: fixture.refreshToken }),
        expires_in: 3600, scope: fixture.wrongScope ? 'read:jira-user write:jira-work offline_access' : 'read:jira-user offline_access' });
    }
    assert.equal(init.method, 'GET');
    const bearer = headers.get('Authorization')?.slice(7); assert.ok(issued.has(bearer));
    if (address === 'https://api.atlassian.com/oauth/token/accessible-resources') return Response.json([
      ...fixture.sites, { ...jiraSites[0], scopes: ['read:confluence-content.all'] },
    ]);
    assert.equal(url.origin, 'https://api.atlassian.com');
    const match = /^\/ex\/jira\/([a-f0-9-]{36})\/rest\/api\/3\/myself$/.exec(url.pathname); assert.ok(match);
    assert.ok(jiraSites.some(site => site.id === match[1]));
    assert.ok([...url.searchParams.keys()].every(key => key === 'expand'));
    if (fixture.beforeResource) await fixture.beforeResource(init.signal);
    const secrets = [jiraCanaries.clientSecret, jiraCanaries.accessKey, fixture.accessToken, fixture.refreshToken, ...(fixture.extraEcho ?? [])];
    return Response.json(fixture.resourceStatus === 200 ? { accountId: fixture.accountId, displayName: 'Operations user', active: true,
      ...(fixture.echo ? { echoes: secrets, [secrets[0]]: 'private key name' } : {}) }
      : { errorMessages: secrets, errors: {} }, { status: fixture.resourceStatus });
  };
  fixture.host = await createJiraCompanion(fixture.config, { store: fixture.store, fetchRequest: fixture.provider, now: fixture.now });
  fixture.clientFetch = async (address, init = {}) => {
    assert.equal(new URL(address).origin, fixture.config.publicOrigin);
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
    const headers = new Headers(init.headers); headers.set('Origin', fixture.config.operationsOrigins[0]);
    fixture.hostRequests.push({ address, headers: new Headers(headers), body: init.body, method: init.method });
    if (fixture.clientFailure) throw new Error('Host not reachable');
    const response = await fixture.host.handle(new Request(address, { ...init, headers }));
    const body = await response.clone().json(); fixture.hostReplies.push({ path: new URL(address).pathname, body, status: response.status });
    if (body.capability) fixture.selected = body;
    return response;
  };
  fixture.callback = async (task, options = {}) => {
    const authorization = new URL(task.authorizationUrl); assert.equal(authorization.origin, 'https://auth.atlassian.com');
    assert.equal(authorization.searchParams.get('audience'), 'api.atlassian.com'); assert.equal(authorization.searchParams.get('scope'), 'read:jira-user offline_access');
    const callback = new URL(fixture.config.publicOrigin + '/oauth/jira/callback');
    callback.searchParams.set('state', options.state ?? authorization.searchParams.get('state'));
    callback.searchParams.set(options.denied ? 'error' : 'code', options.denied ? 'access_denied' : jiraCanaries.code);
    if (options.duplicate) callback.searchParams.append('code', 'second-code');
    const response = await fixture.host.handle(new Request(callback));
    assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), fixture.config.publicOrigin + '/oauth/jira/complete');
    return response;
  };
  fixture.close = () => fixture.host.close();
  return fixture;
}
