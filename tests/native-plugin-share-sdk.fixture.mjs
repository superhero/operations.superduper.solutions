// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativePluginSdkFixture } from './native-plugin-sdk.fixture.mjs';
import { seedNativePluginInstallation } from './native-plugin-install-sdk.fixture.mjs';

export const ownedSharedPluginId = 'plugins_owned_0000000000000000';
export async function seedNativePluginSharing(home, workspace, options = {}) {
  const state = { created: options.created ?? false, discoverability: 'PRIVATE', principals: [], actions: [], uploads: [], uploadRequests: [] };
  const owner = { principal_type: 'user', principal_id: 'owned-user', role: 'owner', name: 'Owned user' };
  state.principals = [owner]; let backend;
  backend = await seedNativePluginInstallation(home, workspace, {
    pluginName: 'owned-plugin',
    async bundleRoute({ request, response, installation }) {
      if (!request.url?.startsWith('/owned-upload/')) return false;
      if (request.method !== 'PUT') { response.writeHead(405).end(); return true; }
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 50 * 1024 * 1024) { response.writeHead(413).end(); return true; } chunks.push(chunk); }
      state.uploads.push({ path: request.url, body: Buffer.concat(chunks), authorization: !!request.headers.authorization,
        blobType: request.headers['x-ms-blob-type'], contentType: request.headers['content-type'] });
      response.writeHead(options.failUpload ? 500 : 201, { etag: '"owned-blob-etag"' }).end(); return true;
    },
    route({ request, url, send, body, detail }) {
      const parse = () => body.length ? JSON.parse(body.toString('utf8')) : {};
      const remote = () => ({ ...detail(), id: ownedSharedPluginId, name: 'owned-plugin', scope: 'WORKSPACE', discoverability: state.discoverability,
        share_url: 'https://chatgpt.example/plugins/share/owned-share', share_principals: state.principals, can_publish_to_workspace: true });
      if (request.method === 'GET' && url.pathname === '/ps/plugins/' + ownedSharedPluginId) { send(200, remote()); return true; }
      if (request.method === 'GET' && url.pathname === '/ps/plugins/workspace/created') { send(200, { plugins: state.created ? [remote()] : [], pagination: { limit: 200, next_page_token: null } }); return true; }
      if (request.method === 'POST' && url.pathname === '/public/plugins/workspace/upload-url') {
        const input = parse(), id = 'owned-file-' + (state.uploadRequests.length + 1), etag = '"owned-upload-etag-' + id + '"';
        state.uploadRequests.push({ input, id, etag });
        send(201, { file_id: id, upload_url: new URL('/owned-upload/' + id, backend.installation.bundleUrl).href, etag }); return true;
      }
      if (request.method === 'POST' && [ '/public/plugins/workspace', '/public/plugins/workspace/' + ownedSharedPluginId ].includes(url.pathname)) {
        const input = parse(), upload = state.uploadRequests.find(u => u.id === input.file_id);
        if (!upload || upload.etag !== input.etag || !state.uploads.some(u => u.path === '/owned-upload/' + upload.id)) { send(400, { error: 'Owned upload was not confirmed.' }); return true; }
        state.actions.push({ method: 'save', path: url.pathname, input }); state.created = true;
        state.discoverability = input.discoverability ?? state.discoverability;
        if (Array.isArray(input.share_targets)) state.principals = [owner, ...input.share_targets.map(p => ({ ...p, name: 'Owned ' + p.principal_type }))];
        send(201, { plugin_id: ownedSharedPluginId, share_url: 'https://chatgpt.example/plugins/share/owned-share', can_publish_to_workspace: true }); return true;
      }
      if (request.method === 'PUT' && url.pathname === '/ps/plugins/' + ownedSharedPluginId + '/shares') {
        if (options.denyTargets) { send(403, { error: 'Owned share permission denied.' }); return true; }
        const input = parse(); state.actions.push({ method: 'targets', input }); state.discoverability = input.discoverability;
        state.principals = [owner, ...input.targets.map(p => ({ ...p, name: 'Owned ' + p.principal_type }))];
        send(200, { principals: state.principals, discoverability: state.discoverability }); return true;
      }
      if (request.method === 'DELETE' && url.pathname === '/public/plugins/workspace/' + ownedSharedPluginId) {
        state.actions.push({ method: 'delete' }); state.created = false; send(204); return true;
      }
      return false;
    }
  });
  backend.sharing = state; return backend;
}
export async function nativePluginShareSdkFixture(options = {}) {
  return nativePluginSdkFixture({ backendFactory: (home, workspace) => seedNativePluginSharing(home, workspace, options),
    seedRuntime(f) { f.caCertificate = f.backend.caCertificate; } });
}
