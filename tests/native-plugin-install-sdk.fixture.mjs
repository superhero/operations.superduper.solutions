// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { nativeTlsFixture } from './native-runtime.fixture.mjs';
import { nativePluginSdkFixture, seedNativePluginBackend, ownedRemotePluginId } from './native-plugin-sdk.fixture.mjs';

function pluginBundle(version, options) {
  const files = { '.codex-plugin/plugin.json': JSON.stringify({ name: options.pluginName ?? 'owned-remote', version, ...(options.workspaceHooks ? { hooks: './hooks/hooks.json' } : {}) }),
    'skills/owned-skill/SKILL.md': '---\nname: owned-skill\ndescription: Owned remote skill\n---\nBundle version ' + version + '\n' };
  if (options.workspaceHooks) files['hooks/hooks.json'] = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf owned-hook', timeout: 1 }] }] } });
  const chunks = [];
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text), header = Buffer.alloc(512), octal = (position, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', position, length, 'ascii');
    header.write(path); octal(100, 8, 0o644); octal(108, 8, 1000); octal(116, 8, 1000); octal(124, 12, data.length); octal(136, 12, 0);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, value) => sum + value, 0); header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(chunks));
}
export async function seedNativePluginInstallation(home, workspace, options = {}) {
  const tls = await nativeTlsFixture(), state = { version: '1.0.0', installed: false, enabled: true, downloads: [], actions: [] };
  const execute = promisify(execFile), keyPath = join(tls.directory, 'server.key'), requestPath = join(tls.directory, 'server.csr'), certPath = join(tls.directory, 'server.crt'), extensionsPath = join(tls.directory, 'server.ext');
  await execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', keyPath, '-out', requestPath], { timeout: 10000, maxBuffer: 8192 });
  await writeFile(extensionsPath, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  // Keep OpenSSL's sidecar inside the owned root even when TMPDIR has a dot.
  await execute('openssl', ['x509', '-req', '-in', requestPath, '-CA', join(tls.directory, 'cert'), '-CAkey', join(tls.directory, 'key'), '-CAserial', join(tls.directory, 'ca.srl'), '-CAcreateserial', '-days', '1', '-extfile', extensionsPath, '-out', certPath], { timeout: 10000, maxBuffer: 8192 });
  let backend;
  const server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (request, response) => {
    try {
      if (await options.bundleRoute?.({ request, response, installation: state })) return;
      state.downloads.push({ path: request.url, authorization: !!request.headers.authorization, version: state.version });
      if (request.url !== '/owned-bundle.tar.gz') { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'application/gzip' }); response.end(pluginBundle(state.version, options));
    } catch { if (!response.headersSent) response.writeHead(500); response.end('Owned bundle fixture failed.'); }
  });
  await new Promise(resolve => server.listen(0, options.wrongHostname ? '127.0.0.2' : '127.0.0.1', resolve));
  const certificate = join(home, '.operations-owned-ca.pem'); await writeFile(certificate, tls.cert, { mode: 0o600 });
  state.bundleUrl = 'https://' + (options.wrongHostname ? '127.0.0.2' : '127.0.0.1') + ':' + server.address().port + '/owned-bundle.tar.gz';
  const detail = () => ({ id: ownedRemotePluginId, name: options.pluginName ?? 'owned-remote', scope: options.workspaceHooks ? 'WORKSPACE' : 'GLOBAL', ...(options.workspaceHooks ? { discoverability: 'LISTED' } : {}), status: 'ENABLED', enabled: state.enabled,
    installation_policy: 'AVAILABLE', authentication_policy: 'ON_USE', release: { version: state.version, bundle_download_url: state.bundleUrl,
      display_name: 'Owned remote plugin', description: 'Owned remote bundle fixture', app_ids: [], skills: [], interface: {} } });
  try {
    backend = await seedNativePluginBackend(home, workspace, { async route({ request, url, send, body }) {
      if (await options.route?.({ request, url, send, body, installation: state, detail })) return true;
      if (request.method === 'GET' && url.pathname === '/ps/plugins/installed') { send(200, { plugins: state.installed && (options.workspaceHooks ? url.searchParams.get('scope') == null || url.searchParams.get('scope') === 'WORKSPACE' : url.searchParams.get('scope') !== 'WORKSPACE') ? [detail()] : [], pagination: { limit: 200, next_page_token: null } }); return true; }
      if (request.method === 'GET' && url.pathname === '/ps/plugins/' + ownedRemotePluginId) { send(200, detail()); return true; }
      if (request.method === 'POST' && ['/ps/plugins/' + ownedRemotePluginId + '/install', '/ps/plugins/' + ownedRemotePluginId + '/uninstall'].includes(url.pathname)) {
        state.installed = url.pathname.endsWith('/install'); state.enabled = state.installed;
        state.actions.push({ path: url.pathname, body: body.length ? JSON.parse(body.toString('utf8')) : null });
        send(200, { id: ownedRemotePluginId, enabled: state.installed, app_ids_needing_auth: [] }); return true;
      }
      return false;
    } });
    const config = join(home, 'config.toml'); await writeFile(config, (await readFile(config, 'utf8')).replace('plugins=true', 'plugins=false' + (options.workspaceHooks ? '\nhooks=true' : '')), { mode: 0o600 });
    const close = backend.close;
    backend.installation = state; backend.caCertificate = certificate;
    backend.close = async () => { try { await close(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); } };
    return backend;
  } catch (error) { await backend?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); throw error; }
}
export async function nativePluginInstallationSdkFixture(options = {}) {
  return nativePluginSdkFixture({ backendFactory: (home, workspace) => seedNativePluginInstallation(home, workspace, options), async seedRuntime(f) {
    f.caCertificate = f.backend.caCertificate; await options.seedRuntime?.(f);
  } });
}
