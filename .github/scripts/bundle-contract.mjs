// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUNDLE_FILES = ['_headers', 'apple-touch-icon.png', 'favicon.bmp', 'favicon.gif', 'favicon.ico',
  'favicon.jpg', 'favicon.png', 'favicon.ppm', 'favicon.svg', 'favicon.tiff', 'index.html'];
export const SPEECH_FILES = ['speech/worker.js', 'speech/features.js', 'speech/licenses/NOTICES.md',
  'speech/licenses/TEN-VAD-LICENSE', 'speech/licenses/TEN-VAD-NOTICES', 'speech/licenses/parakeet.js-LICENSE',
  'speech/licenses/onnxruntime-LICENSE', 'speech/licenses/onnxruntime-ThirdPartyNotices.txt'];
const chunk = /^speech\/chunks\/[A-Za-z0-9_-]+\.js$/;

// Retain legacy complete bundles for validation reuse. A speech directory, when
// present, must contain both entry points, shared chunks and all license files.
export function validBundlePaths(paths) {
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length || !BUNDLE_FILES.every(path => paths.includes(path))) return false;
  if (paths.length === BUNDLE_FILES.length) return true;
  return SPEECH_FILES.every(path => paths.includes(path)) && paths.some(path => chunk.test(path))
    && paths.every(path => BUNDLE_FILES.includes(path) || SPEECH_FILES.includes(path) || chunk.test(path));
}

export function listBundleFiles(directory) {
  const absolute = resolve(directory), paths = [];
  for (let path = absolute; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid bundle directory.');
    if (dirname(path) === path) break;
  }
  function visit(relative = '') {
    const entries = readdirSync(join(absolute, relative));
    if (!entries.length) throw new Error('Empty bundle directory.');
    for (const name of entries) {
      if (name.startsWith('.') || /[\0\r\n\\]/.test(name)) throw new Error('Unsupported bundle filename.');
      const path = relative ? `${relative}/${name}` : name, stat = lstatSync(join(absolute, path));
      if (stat.isSymbolicLink()) throw new Error('Bundle contains a symlink.');
      if (stat.isDirectory()) visit(path);
      else {
        if (!stat.isFile() || !stat.size || stat.size > 25 * 1024 ** 2) throw new Error('Invalid bundle file or Pages size limit exceeded.');
        paths.push(path);
      }
    }
  }
  visit();
  if (!validBundlePaths(paths)) throw new Error('Incomplete or unsupported application bundle.');
  return paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected bundle directory.');
    process.stdout.write(listBundleFiles(process.argv[2]).join('\0') + '\0');
  } catch { process.stderr.write('Invalid deployment bundle contents.\n'); process.exitCode = 1; }
}
