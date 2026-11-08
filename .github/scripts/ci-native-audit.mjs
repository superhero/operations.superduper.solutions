// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const validName = value => typeof value === 'string' && /^operations-native-[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const validWindow = (start, finish) => Number.isFinite(start) && Number.isFinite(finish)
  && start > 0 && finish >= start && finish - start <= 30_000;
const fields = ['apparmor', 'operation', 'class', 'info', 'error', 'comm', 'fstype', 'flags', 'requested_mask', 'denied_mask', 'name', 'srcname'];
const sandboxTargets = new Set(['/', '/newroot', '/newroot/', '/newroot/proc', '/newroot/proc/', '/newroot/dev', '/newroot/dev/',
  '/newroot/tmp', '/newroot/tmp/', '/proc', '/proc/', '/dev', '/dev/', '/tmp', '/tmp/']);
const redact = value => value.replace(/\/[\w./:@%+=,-]+/g, '<path>')
  .replace(/\b(?:bearer|token|password|secret|api[_-]?key|authorization)\s*[:= ]\s*[^\s;,]+/gi, '<redacted>')
  .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 220);

export function ownedAppArmorAuditLine(line, { profileName, startedAt, finishedAt } = {}) {
  if (!validName(profileName) || !validWindow(startedAt, finishedAt) || typeof line !== 'string' || line.length > 16_384) return;
  const profile = line.match(/\bprofile="([^"\r\n]+)"/)?.[1];
  const eventTime = line.match(/\baudit\((\d{10}(?:\.\d{1,6})?):\d+\)/)?.[1];
  const pid = line.match(/\bpid=(\d+)\b/)?.[1];
  const epochMilliseconds = Number(eventTime) * 1000, hostPid = Number(pid);
  if (profile !== profileName || !/\bapparmor="(?:DENIED|ALLOWED|AUDIT)"/.test(line)
    || !Number.isSafeInteger(hostPid) || hostPid < 1 || !Number.isFinite(epochMilliseconds)
    || epochMilliseconds < startedAt - 250 || epochMilliseconds > finishedAt + 250) return;
  const record = { profile: profileName, hostPid, epochMilliseconds };
  // Kernel audit host PIDs belong to this unique owned profile and time window;
  // container process.pid has a different namespace and is never substituted.
  for (const name of fields) {
    const value = line.match(new RegExp(`\\b${name}=(?:"([^"\\r\\n]*)"|([^\\s]+))`));
    if (value) {
      const raw = value[1] ?? value[2];
      record[name] = ['name', 'srcname'].includes(name) ? sandboxTargets.has(raw) ? raw : '<path>' : redact(raw);
    }
  }
  return record;
}

async function readOwnedAudit(options) {
  return new Promise(resolveResult => {
    // The privileged timeout owns dmesg's deadline; an unprivileged parent may
    // not be able to signal a child after sudo changes its credentials.
    const child = spawn('sudo', ['-n', 'timeout', '--signal=TERM', '--kill-after=1s', '3s', 'dmesg', '--color=never', '--raw'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    const records = []; let pending = '', finished = false;
    const done = code => {
      if (finished) return; finished = true; clearTimeout(timer);
      resolveResult({ state: code === 0 ? 'available' : 'unavailable', profile: options.profileName,
        pidNamespace: 'host', records: code === 0 ? records : [] });
    };
    const inspect = line => { if (records.length < 20) { const record = ownedAppArmorAuditLine(line, options); if (record) records.push(record); } };
    child.stdout.on('data', bytes => {
      pending += bytes.toString('utf8');
      let end;
      while ((end = pending.indexOf('\n')) >= 0) { inspect(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (pending.length > 16_384) pending = '';
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(124); }, 5000);
    child.once('error', () => done(1));
    child.once('close', code => { if (pending) inspect(pending); done(code); });
  });
}

export async function captureNativeAppArmorAudit({ run, root = process.cwd(), profileName, startedAt, finishedAt } = {}) {
  if (!validName(profileName) || !validWindow(startedAt, finishedAt)) return { state: 'unavailable', reason: 'owned-profile-window-unavailable', records: [] };
  try {
    const result = await run(process.execPath, [fileURLToPath(import.meta.url), profileName, String(startedAt), String(finishedAt)],
      { cwd: root, quiet: true, timeoutMs: 6000 });
    if (result.code !== 0) throw new Error();
    const evidence = JSON.parse(result.output);
    if (!['available', 'unavailable'].includes(evidence.state) || evidence.profile !== profileName || !Array.isArray(evidence.records)) throw new Error();
    return evidence;
  } catch { return { state: 'unavailable', reason: 'owned-kernel-audit-unavailable', records: [] }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profileName, start, finish] = process.argv.slice(2), startedAt = Number(start), finishedAt = Number(finish);
  if (!validName(profileName) || !validWindow(startedAt, finishedAt)) process.exitCode = 1;
  else console.log(JSON.stringify(await readOwnedAudit({ profileName, startedAt, finishedAt })));
}
