// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativePluginSdkFixture } from './native-plugin-sdk.fixture.mjs';

const execute = promisify(execFile);
export const ownedMarketplaceUrl = 'https://owned-market.example.test/repository.git';
/** Manual Git mode honors this dedicated HOME; no public Git request is made. */
export async function seedNativeMarketplaces(home, workspace) {
  const local = join(workspace, 'local-market'), git = join(workspace, 'git-market');
  for (const [directory, name] of [[local, 'owned-local-market'], [git, 'owned-git-market']]) {
    await mkdir(join(directory, '.agents/plugins'), { recursive: true });
    await writeFile(join(directory, '.agents/plugins/marketplace.json'), JSON.stringify({ name, plugins: [] }));
    await writeFile(join(directory, 'marker.txt'), 'owned initial marketplace\n');
  }
  const command = args => execute('git', args, { cwd: git, timeout: 10000, maxBuffer: 16384, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1' } });
  await command(['init', '-b', 'main']); await command(['config', 'user.email', 'owned-market@example.test']); await command(['config', 'user.name', 'Owned marketplace fixture']);
  await command(['add', '.']); await command(['commit', '-m', 'Owned initial marketplace']);
  await writeFile(join(home, '.gitconfig'), '[url ' + JSON.stringify(pathToFileURL(git).href) + ']\n\tinsteadOf = ' + ownedMarketplaceUrl + '\n', { mode: 0o600 });
  const configuration = await readFile(join(home, 'config.toml'), 'utf8');
  await writeFile(join(home, 'config.toml'), configuration.replace('plugins=true', 'plugins=false').replace('plugin_sharing=true', 'plugin_sharing=false'), { mode: 0o600 });
  return { local, git, source: ownedMarketplaceUrl,
    async update() { await writeFile(join(git, 'marker.txt'), 'owned updated marketplace\n'); await command(['add', 'marker.txt']); await command(['commit', '-m', 'Owned marketplace update']); return (await command(['rev-parse', 'HEAD'])).stdout.trim(); } };
}
export async function nativeMarketplaceSdkFixture() {
  return nativePluginSdkFixture({ async seedRuntime(f) { f.marketplaces = await seedNativeMarketplaces(f.home, f.workspace); } });
}

/** An owned pre-existing registration/cache for the browser's single action. */
export async function seedNativeMarketplaceAction(home, workspace, method) {
  const fixture = await seedNativeMarketplaces(home, workspace);
  if (method === 'marketplace/add') return fixture;
  const config = join(home, 'config.toml');
  await writeFile(config, await readFile(config, 'utf8') + '\n[marketplaces."owned-git-market"]\nsource_type="git"\nsource=' + JSON.stringify(fixture.source) + '\nref="main"\n', { mode: 0o600 });
  const root = join(home, '.tmp/marketplaces/owned-git-market'); await mkdir(join(home, '.tmp/marketplaces'), { recursive: true });
  await execute('git', ['clone', '--', fixture.source, root], { timeout: 10000, maxBuffer: 16384,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1' } });
  if (method === 'marketplace/upgrade') await fixture.update();
  return fixture;
}
