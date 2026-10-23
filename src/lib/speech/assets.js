// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { createSHA256, createSHA1 } from 'hash-wasm';
import { getModelFile } from 'parakeet.js/hub';
import { modelLock, speechProfiles, largeModelCache } from './config.js';
import runtimeLock from './runtime.lock.json';

// The SDK buffers every downloaded chunk before creating its cached Blob. A
// 2.4 GB external-data file can exhaust memory before inference even starts.
// OPFS gives it a disk-backed File instead; the caller still verifies every pin.
export async function speechModelFile(repo, file, options) {
  if (file !== 'encoder-model.onnx.data') return getModelFile(repo, file, options);
  if (!navigator.storage?.getDirectory) throw new Error('This browser cannot stream large GPU weights into local storage. Choose CPU explicitly.');
  return navigator.locks.request(`${largeModelCache}/${options.revision}/${file}`, async () => {
    const root = await navigator.storage.getDirectory();
    const cache = await root.getDirectoryHandle(largeModelCache, { create: true });
    const directory = await cache.getDirectoryHandle(options.revision, { create: true });
    const handle = await directory.getFileHandle(file, { create: true });
    const pin = modelLock.files.find(pin => pin.file === file);
    let payload = await handle.getFile();
    if (payload.size !== pin.bytes) {
      const response = await fetch(`https://huggingface.co/${repo}/resolve/${options.revision}/${file}`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Speech weights download failed (${response.status}).`);
      const writable = await handle.createWritable(), reader = response.body.getReader();
      let loaded = 0, reported = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          loaded += value.length;
          if (loaded > pin.bytes) throw new Error('Speech weights exceed their pinned size.');
          await writable.write(value);
          if (performance.now() - reported >= 100 || loaded === pin.bytes) {
            options.progress({ file, loaded, total: pin.bytes }); reported = performance.now();
          }
        }
        if (loaded !== pin.bytes) throw new Error('Speech weights download was incomplete.');
        await writable.close();
      } catch (error) { await writable.abort().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      payload = await handle.getFile();
    }
    return URL.createObjectURL(payload);
  });
}

export async function verifyBlob(blob, pin) {
  if (blob.size !== pin.bytes) throw new Error(`Size mismatch for ${pin.file}. Clear the speech cache and retry.`);
  const hash = pin.sha256 ? await createSHA256() : await createSHA1();
  hash.init();
  // Git hashes cover the blob header as well as its bytes; SHA-256 pins don't.
  hash.update(pin.sha256 ? '' : `blob ${blob.size}\0`);
  const reader = blob.stream().getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); } }
  finally { reader.releaseLock(); }
  if (hash.digest() !== (pin.sha256 || pin.gitBlob)) throw new Error(`Integrity check failed for ${pin.file}. Clear the speech cache and retry.`);
}

export async function modelFiles(mode, progress, { getFile = speechModelFile, verify = verifyBlob } = {}) {
  const profile = speechProfiles.find(p => p.value === mode);
  if (!profile) throw new Error('Unknown speech profile.');
  const urls = [], files = {};
  try {
    for (const file of profile.files) {
      progress({ text: `Checking ${file}…` });
      const url = await getFile(modelLock.browserArtifact, file, { revision: modelLock.revision, progress });
      urls.push(url);
      const blob = await (await fetch(url)).blob();
      progress({ text: `Verifying ${file}…` });
      await verify(blob, modelLock.files.find(pin => pin.file === file)); files[file] = url;
    }
    return { encoderUrl: files[profile.encoder], decoderUrl: files['decoder_joint-model.int8.onnx'], tokenizerUrl: files['vocab.txt'],
      ...(files['encoder-model.onnx.data'] ? { encoderDataUrl: files['encoder-model.onnx.data'] } : {}),
      filenames: { encoder: profile.encoder, decoder: 'decoder_joint-model.int8.onnx' },
      release: () => urls.forEach(url => URL.revokeObjectURL(url)),
    };
  } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); throw error; }
}

export async function runtimeFiles(progress, { verify = verifyBlob } = {}) {
  // Cache only verified immutable resources. Browser eviction is allowed;
  // loading missing resources requires a connection, inference never does.
  const cache = await caches.open('operations-parakeet-ort-1.30.0');
  const urls = [];
  try {
    for (const pin of runtimeLock.files) {
      const url = runtimeLock.base + pin.file;
      progress({ text: `Checking speech runtime ${pin.file}…` });
      let response = await cache.match(url);
      if (!response) {
        response = await fetch(url, { credentials: 'omit' });
        if (!response.ok) throw new Error(`Speech runtime download failed (${response.status}).`);
        const blob = await response.blob(); await verify(blob, pin);
        response = new Response(blob); await cache.put(url, response.clone());
      }
      const blob = await response.blob(); await verify(blob, pin);
      urls.push(URL.createObjectURL(new Blob([blob], { type: pin.file.endsWith('.mjs') ? 'text/javascript' : 'application/wasm' })));
    }
    return { mjs: urls[0], wasm: urls[1] };
  } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); throw error; }
}
