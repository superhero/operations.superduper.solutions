// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export const maximumAsyncWorkerBytes = 24 * 1024 * 1024;
// Reuse the actual compact-pack decoder, rather than maintaining a second
// alphabet/codec. This generated source executes only inside the worker.
const decoder = stripTypeScriptTypes(readFileSync(new URL('../src/lib/schema-pack-codec.ts',import.meta.url),'utf8'))
  .replace(/^export /gm,'');

async function startPackedWorker(packed,expectedBytes,limit,decode) {
  const queued=[],replayed=new WeakSet();
  const buffer=event=>{
    if (replayed.has(event)) return;
    event.stopImmediatePropagation();
    if (queued.length>=128) throw new Error('Worker initialization queue is full.');
    queued.push(event);
  };
  self.addEventListener('message',buffer);
  let url;
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes<=0 || expectedBytes>limit) throw new Error('Invalid packed worker size.');
    const compressed=decode(packed);
    if (compressed.length<18 || new DataView(compressed.buffer,compressed.byteOffset,compressed.byteLength).getUint32(compressed.byteLength-4,true)!==expectedBytes)
      throw new Error('Invalid packed worker length.');
    const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const bytes=new Uint8Array(expectedBytes);let offset=0;
    try {
      while (true) {
        const {done,value}=await reader.read();if (done) break;
        if (offset+value.byteLength>expectedBytes) throw new Error('Packed worker exceeds its declared size.');
        bytes.set(value,offset);offset+=value.byteLength;
      }
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    if (offset!==expectedBytes) throw new Error('Incomplete packed worker.');
    url=URL.createObjectURL(new Blob([bytes],{type:'text/javascript;charset=utf-8'}));
    await import(/* @vite-ignore */ url);
    // Keep early RPCs in arrival order, yielding between messages as the
    // original worker event loop does. No decoded program crosses the page.
    while (queued.length) {
      const event=queued.shift(),copy=new MessageEvent('message',{data:event.data,ports:event.ports,origin:event.origin,lastEventId:event.lastEventId});
      replayed.add(copy);self.dispatchEvent(copy);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    self.removeEventListener('message',buffer);
  } catch (error) {
    queued.length=0;self.removeEventListener('message',buffer);
    setTimeout(()=>{throw error;},0);
  } finally {if (url) URL.revokeObjectURL(url);}
}

export function createAsyncInlineWorkerProgram(packed,expectedBytes) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes<=0 || expectedBytes>maximumAsyncWorkerBytes)
    throw new Error('Invalid asynchronous worker size.');
  return `(()=>{${decoder}\n(${startPackedWorker.toString()})(${JSON.stringify(packed)},${expectedBytes},${maximumAsyncWorkerBytes},decodeCompactSchemaPack);})();`;
}
