// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Then } from '@cucumber/cucumber';
import { JsPreprocessor } from 'parakeet.js/mel';
import { SentenceMerger, endsSentence } from './lib/speech/sentence-merger.js';
import { LiveDecoder } from './lib/speech/live-decoder.js';
import { ContinuousFeatures } from './lib/speech/features.js';
import { SpeechActivity } from './lib/speech/speech-activity.js';
import { TenVad } from './lib/speech/ten-vad.js';
import { appendDictation, speechPreferences, speechProfiles, modelLock } from './lib/speech/config.js';
import { wav, compare, signalStats } from './lib/speech/diagnostics.js';
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { getModelFile } from 'parakeet.js/hub';
import { verifyBlob, modelFiles, runtimeFiles, speechModelFile } from './lib/speech/assets.js';
import { FeaturesServer } from './lib/speech/features.js';
import { LiveFeatures } from './lib/speech/live-features.js';
vi.mock('parakeet.js/hub', () => ({ getModelFile: vi.fn() }));

Then('large speech weights stream without buffering the full download', async () => {
  const file = 'encoder-model.onnx.data', pin = modelLock.files.find(pin => pin.file === file), originalSize = pin.bytes;
  const progress = vi.fn(), options = { revision: modelLock.revision, progress };
  const fetch = vi.spyOn(globalThis, 'fetch');
  const now = vi.spyOn(performance, 'now');
  let payload = new Blob(), aborted = 0, writeFails = false, abortFails = false;
  const handle = { getFile: async () => payload, createWritable: async () => {
    const chunks = [];
    return { write: async value => { if (writeFails) throw Error('Disk full'); chunks.push(value); },
      close: async () => { payload = new Blob(chunks); }, abort: async () => { aborted++; if (abortFails) throw Error('Abort failed'); } };
  } };
  const directory = { getDirectoryHandle: async () => directory, getFileHandle: async () => handle };
  try {
    getModelFile.mockResolvedValue('blob:small-file');
    assert.equal(await speechModelFile('repo', 'vocab.txt', options), 'blob:small-file');
    vi.stubGlobal('navigator', { storage: {}, locks: { request: async (_, callback) => callback() } });
    await assert.rejects(speechModelFile('repo', file, options), /cannot stream/);
    navigator.storage.getDirectory = async () => directory;
    pin.bytes = 3;
    now.mockReturnValue(0);
    fetch.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(97)); controller.enqueue(Uint8Array.of(98, 99)); controller.close(); } })));
    const url = await speechModelFile('repo', file, options); URL.revokeObjectURL(url);
    assert.equal(await payload.text(), 'abc'); assert.equal(progress.mock.calls.length, 1); assert.equal(progress.mock.calls[0][0].total, 3);
    const calls = fetch.mock.calls.length;
    const cached = await speechModelFile('repo', file, options); URL.revokeObjectURL(cached); assert.equal(fetch.mock.calls.length, calls);
    payload = new Blob(); now.mockReturnValue(1000);
    fetch.mockResolvedValue(new Response('', { status: 503 })); await assert.rejects(speechModelFile('repo', file, options), /503/);
    fetch.mockResolvedValue(new Response('ab')); await assert.rejects(speechModelFile('repo', file, options), /incomplete/);
    fetch.mockResolvedValue(new Response('abcd')); await assert.rejects(speechModelFile('repo', file, options), /pinned size/);
    writeFails = true; abortFails = true;
    fetch.mockResolvedValue(new Response('abc')); await assert.rejects(speechModelFile('repo', file, options), /Disk full/); assert.equal(aborted, 3);
    assert(fetch.mock.calls.every(([url, init]) => url.includes(modelLock.revision) && init.credentials === 'omit'));
  } finally { pin.bytes = originalSize; fetch.mockRestore(); now.mockRestore(); vi.unstubAllGlobals(); }
});

Then('speech resources enforce immutable pins and release failed downloads', async () => {
  const blob = new Blob(['abc']);
  await verifyBlob(blob, { file: 'test', bytes: 3, sha256: createHash('sha256').update('abc').digest('hex') });
  await verifyBlob(blob, { file: 'test', bytes: 3, gitBlob: createHash('sha1').update('blob 3\0abc').digest('hex') });
  await assert.rejects(verifyBlob(blob, { file: 'test', bytes: 4 }), /Size mismatch/);
  await assert.rejects(verifyBlob(blob, { file: 'test', bytes: 3, sha256: 'bad' }), /Integrity/);
  let released = false;
  await assert.rejects(verifyBlob({ size: 3, stream: () => ({ getReader: () => ({ read: async () => { throw Error('Read failed'); }, releaseLock: () => released = true }) }) }, { file: 'test', bytes: 3, sha256: 'bad' }), /Read failed/);
  assert(released);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('test'));
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const verify = vi.fn(async () => {});
  getModelFile.mockImplementation(async () => URL.createObjectURL(blob));
  try {
    for (const mode of ['cpu', 'gpu-fp32']) {
      const files = await modelFiles(mode, () => {}, { verify, getFile: getModelFile });
      assert.equal(Boolean(files.encoderDataUrl), mode === 'gpu-fp32'); files.release();
    }
    assert(getModelFile.mock.calls.every(([repo, , options]) => repo === modelLock.browserArtifact && options.revision === modelLock.revision));
    assert(verify.mock.calls.every(([, pin]) => modelLock.files.includes(pin)));
    await assert.rejects(modelFiles('fp16', () => {}), /Unknown/);
    await assert.rejects(modelFiles('cpu', () => {}), /Size mismatch/);
    await assert.rejects(modelFiles('cpu', () => {}, { getFile: async () => { throw Error('Download failed'); } }), /Download failed/);
    const cache = new Map();
    vi.stubGlobal('caches', { open: async () => ({ match: async key => cache.get(key)?.clone(), put: async (key, response) => cache.set(key, response) }) });
    const paths = await runtimeFiles(() => {}, { verify });
    assert(paths.mjs.startsWith('blob:')); assert(paths.wasm.startsWith('blob:'));
    URL.revokeObjectURL(paths.mjs); URL.revokeObjectURL(paths.wasm);
    assert.equal(cache.size, 2); const calls = fetch.mock.calls.length;
    const cached = await runtimeFiles(() => {}, { verify });
    URL.revokeObjectURL(cached.mjs); URL.revokeObjectURL(cached.wasm); assert.equal(fetch.mock.calls.length, calls);
    await assert.rejects(runtimeFiles(() => {}), /Size mismatch/);
    cache.clear(); fetch.mockResolvedValue(new Response('', { status: 503 }));
    await assert.rejects(runtimeFiles(() => {}, { verify }), /503/); assert.equal(cache.size, 0);
    fetch.mockImplementation(async () => new Response('test'));
    await assert.rejects(runtimeFiles(() => {}, { verify: async (_, pin) => { if (pin.file.endsWith('.wasm')) throw Error('Corrupt WASM'); } }), /Corrupt/);
    assert(revoke.mock.calls.length >= 9);
  } finally { fetch.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
});

Then('speech workers reject invalid ranges and close pending feature requests', async () => {
  const endpoint = () => ({ messages: [], postMessage(value) { this.messages.push(value); } });
  const owner = endpoint(), client = endpoint(), other = endpoint(), server = new FeaturesServer(owner);
  server.receive(owner, { type: 'connect', port: client }); server.attach(other);
  server.receive(client, { type: 'compute', id: 1, startSample: 0, endSample: 160 });
  server.receive(other, { type: 'compute', id: 2, startSample: 0, endSample: 160 });
  server.receive(client, { type: 'disconnect' }); assert.equal(server.waiting.length, 1);
  server.receive(owner, { type: 'init' }); server.receive(owner, { type: 'push', pcm: new Float32Array(160) });
  assert.equal(other.messages.at(-1).id, 2);
  server.receive(other, { type: 'compute', id: 3, startSample: 0, endSample: 160 }); assert.equal(other.messages.at(-1).id, 3);
  server.reply(other, { id: 4, startSample: 3, endSample: 160 }); assert.match(other.messages.at(-1).error, /aligned/);
  server.receive(owner, { type: 'unknown' }); server.receive(owner, { type: 'close' });
  const late = endpoint(); server.attach(late); assert(late.messages.at(-1).fatal);
  server.receive(other, { type: 'compute' }); assert(other.messages.at(-1).fatal);
  const duplicate = new FeaturesServer(endpoint()); duplicate.receive(owner, { type: 'init' }); duplicate.receive(owner, { type: 'init' }); assert.match(duplicate.failure, /already initialized/);
  const transport = endpoint(); transport.terminate = () => transport.terminated = true;
  const rpc = new LiveFeatures(undefined, undefined, () => transport);
  rpc.push(Float32Array.of(.5)); assert.equal(transport.messages.at(-1).pcm[0], .5);
  const port = rpc.connect(); port.close();
  const computed = rpc.compute(0, 160); const id = transport.messages.at(-1).id;
  transport.onmessage({ data: { id: 9999 } }); transport.onmessage({ data: { id, result: 'features' } }); assert.equal(await computed, 'features');
  let reported; rpc.onfailure = error => reported = error.message;
  const pending = rpc.compute(0, 320); transport.onmessage({ data: { fatal: true, error: 'Failed' } }); await assert.rejects(pending, /Failed/);
  assert.equal(reported, 'Failed');
  assert.throws(() => rpc.push(Float32Array.of(1)), /Failed/); rpc.close(); rpc.close(); assert(transport.terminated);
  const failedTransport = endpoint(); failedTransport.terminate = () => {};
  const failed = new LiveFeatures(128, null, () => failedTransport);
  failedTransport.onerror({}); await assert.rejects(failed.compute(0, 160), /Feature worker failed/); failed.close();
  const clientPort = endpoint(); clientPort.start = () => {}; clientPort.close = () => {};
  const reader = new LiveFeatures(128, clientPort);
  assert.throws(() => reader.connect(), /Only/); assert.throws(() => reader.push(new Float32Array()), /Only/);
  reader.close(); await assert.rejects(reader.compute(0, 160), /closed/); assert.throws(() => reader.connect(), /closed/);
  const anotherTransport = endpoint(); anotherTransport.terminate = () => {};
  const another = new LiveFeatures(128, null, () => anotherTransport); anotherTransport.onerror({ message: 'Specific error' }); another.close();
});

Then('speech failures remain bounded and cannot resume closed recordings', async () => {
  const options = { detect: () => [], infer: async () => ({}), update() {}, finish() {}, error() {} };
  const overflow = new LiveDecoder(options); let failure;
  overflow.error = error => failure = error;
  overflow.push(new Float32Array(960001)); assert.match(failure.message, /60 seconds/);
  overflow.push(new Float32Array(160)); overflow.end(new Float32Array()); await overflow.pump();
  const idle = new LiveDecoder(options); await idle.pump(); idle.running = true; await idle.pump();
  const ending = new LiveDecoder(options); ending.ending = true; ending.push(new Float32Array(10)); assert.equal(ending.count, 0);
  let finish; const done = new Promise(resolve => finish = resolve);
  const tail = new LiveDecoder({ ...options, finish }); tail.end(new Float32Array(160)); await done; assert.equal(tail.count, 160);
  const detect = pcm => [{ start: 0, end: pcm.length / 16000, speech: true }];
  const inferred = new LiveDecoder({ ...options, detect }); inferred.push(new Float32Array(16000)); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(inferred.calls, 1);
  const rejected = new LiveDecoder({ ...options, detect, infer: async () => { throw Error('Inference failed'); }, error: error => failure = error });
  rejected.push(new Float32Array(16000)); await new Promise(resolve => setTimeout(resolve, 20)); assert.match(failure.message, /Inference failed/);
  const seam = new SentenceMerger(); const words = (text, offset = 0) => text.split(' ').map((text, i) => ({ text, start_time: offset + i * .3, end_time: offset + i * .3 + .25 }));
  seam.update(words('one two three')); assert.equal(seam.update(words('three four', .7), { windowStart: 1 }).text, 'one two three four');
  seam.update([], { final: true }); assert.equal(seam.contextStart, 0);
  assert.equal(new SentenceMerger().update([{ text: 'bad', start_time: NaN, end_time: 1 }, null]).text, '');
  const vad = await TenVad.create(readFileSync(new URL('./lib/speech/vendor/ten-vad/ten_vad.wasm', import.meta.url)));
  const process = vad.module._ten_vad_process; vad.module._ten_vad_process = () => 1;
  assert.throws(() => vad.process(new Float32Array(256)), /processing failed/); vad.module._ten_vad_process = process;
  const create = vad.module._ten_vad_create; vad.module._ten_vad_create = () => 1;
  assert.throws(() => new TenVad(vad.module), /initialization failed/); vad.module._ten_vad_create = create;
  vad.close(); vad.close();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(readFileSync(new URL('./lib/speech/vendor/ten-vad/ten_vad.wasm', import.meta.url))));
  try { const fetched = await TenVad.create(); fetched.handle = 0; fetched.close(); } finally { fetch.mockRestore(); }
});

Then('speech preferences and confirmed text preserve user control', () => {
  const runtime = JSON.parse(readFileSync(new URL('./lib/speech/runtime.lock.json', import.meta.url)));
  assert.equal(runtime.version, '1.30.0');
  assert.equal(JSON.parse(readFileSync(new URL('../node_modules/parakeet.js/package.json', import.meta.url))).version, '1.4.4');
  for (const pin of runtime.files) {
    assert.match(pin.file, /\.asyncify\.(?:mjs|wasm)$/);
    const bytes = readFileSync(new URL(`../node_modules/onnxruntime-web/dist/${pin.file}`, import.meta.url));
    assert.equal(bytes.length, pin.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
    if (pin.file.endsWith('.mjs')) assert.match(bytes.toString(), /webgpuInit/);
  }
  assert.deepEqual(speechPreferences(null), { mode: 'cpu', restore: true, loaded: false, refine: false });
  assert.deepEqual(speechPreferences({ mode: 'gpu-fp32', restore: false, loaded: true, refine: true }), { mode: 'gpu-fp32', restore: false, loaded: true, refine: true });
  assert.equal(speechPreferences({ mode: 'fp16', loaded: 1, refine: 1 }).mode, 'cpu');
  assert.equal(speechPreferences({ loaded: 1, refine: 1 }).loaded, false);
  assert.equal(speechProfiles.length, 2);
  for (const profile of speechProfiles) assert.equal(profile.bytes, profile.files.reduce((sum, file) => sum + modelLock.files.find(pin => pin.file === file).bytes, 0));
  assert.deepEqual(appendDictation('Typed words.', '', 'First sentence.'), { draft: 'Typed words. First sentence.', confirmed: 'First sentence.', truncated: false });
  assert.equal(appendDictation('User corrected first sentence. ', 'First sentence.', 'First sentence. Second.').draft, 'User corrected first sentence. Second.');
  assert.equal(appendDictation('', '', 'Hello.').draft, 'Hello.');
  assert.equal(appendDictation('Typed', '', '').draft, 'Typed');
  assert.equal(appendDictation('Typed', 'Confirmed.', 'Changing provisional').confirmed, 'Confirmed.');
  assert.deepEqual(appendDictation('1234', '', 'abc', 6), { draft: '1234 a', confirmed: 'abc', truncated: true });
});

Then('speech diagnostics retain exact PCM and explain transcript differences', async () => {
  const blob = wav([Float32Array.of(.5, -.25), Float32Array.of(1, -1)]), data = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(data.byteLength, 60);
  assert.equal(data.getUint16(20, true), 3); assert.equal(data.getUint32(24, true), 16000);
  assert.equal(data.getFloat32(44, true), .5); assert.equal(data.getFloat32(56, true), -1);
  assert.equal((await wav([]).arrayBuffer()).byteLength, 44);
  assert.equal(signalStats([]).rms, 0);
  assert.deepEqual(signalStats([Float32Array.of(1, -1, 0)]), { samples: 3, peak: 1, clippedSamples: 2, rms: Math.sqrt(2 / 3) });
  assert.equal(compare('Hello, WORLD!', 'hello world').wer, 0);
  assert.equal(compare('we said this', 'we meant this').substitutions, 1);
  assert.equal(compare('one two three', 'one three').deletions, 1);
  assert.equal(compare('one three', 'one two three').insertions, 1);
  assert.equal(compare('', 'unexpected').wer, null); assert.equal(compare('all missing', '').deletions, 2);
  assert.equal(compare('don’t', "don't").wer, 0);
});

Then('real speech detection skips silence and restarts cleanly', async () => {
  const vad = await TenVad.create(readFileSync(new URL('./lib/speech/vendor/ten-vad/ten_vad.wasm', import.meta.url)));
  try {
    const silence = new Float32Array(32000);
    assert(vad.process(silence).every(frame => !frame.speech)); vad.reset();
    assert(vad.process(silence).every(frame => !frame.speech));
    let calls = 0, finish;
    const done = new Promise(resolve => finish = resolve);
    const decoder = new LiveDecoder({ detect: pcm => vad.process(pcm), infer: () => { calls++; return { words: [] }; }, update() {}, finish, error: error => { throw error; } });
    decoder.push(silence); decoder.end(silence);
    assert.equal((await done).text, ''); assert.equal(calls, 0);
    const activity = new SpeechActivity();
    activity.observe([{ start: 1, end: 1.1, speech: true }, { start: 1.1, end: 2.2, speech: false }, { start: 3, end: 3.1, speech: true }]);
    assert.equal(activity.segments.length, 2); assert.equal(activity.segments[0].start, .7); assert.equal(activity.segments[0].end, 1.6);
    activity.finish(3.2); assert.equal(activity.segments[1].end, 3.2);
    new SpeechActivity().finish(0);
  } finally { vad.close(); }
});

Then('speech merging preserves confirmed sentences pauses and genuine repetitions', async () => {
const words = (s, offset = 0) => s.split(' ').map((text, i) => ({ text, start_time: offset + i * .3, end_time: offset + i * .3 + .25 }));
const merger = new SentenceMerger();
assert.equal(merger.update(words('We need a')).stableText, '');
assert.equal(merger.update(words('We need help.')).stableText, '', 'last complete sentence stays provisional without following speech');
let state = merger.update(words('We need help. Please continue'));
assert.equal(state.stableText, 'We need help.');
assert.equal(state.draftText, 'Please continue');
state = merger.update(words('We need help. Please proceed'));
assert.equal(state.text, 'We need help. Please proceed', 'provisional correction allowed');
state = merger.update([], { pause: true });
assert.equal(state.stableText, 'We need help. Please proceed');
assert.equal(state.draftText, '');
assert.equal(merger.update([]).stableText, state.stableText);

const repeats = new SentenceMerger();
repeats.update(words('We can do.'));
repeats.update([], { pause: true });
const original = repeats.cursor;
let replay = words('can do. We can do again.', .3).map(w => ({ ...w, start_time: w.start_time + .15, end_time: w.end_time + .15 }));
state = repeats.update(replay, { final: true });
assert.equal(state.text, 'We can do. We can do again.', 'shifted overlap removed but genuine repetition preserved');
assert.ok(state.cursor > original);

const bounded = new SentenceMerger();
bounded.update(words('One very long incomplete sentence'));
state = bounded.update(words('incomplete sentence becomes complete.', .9), { windowStart: .9 });
assert.equal(state.text, 'One very long incomplete sentence becomes complete.');
assert.equal(state.stableText, '', 'bounded window preserves provisional prefix without prematurely maturing it');
assert.equal(bounded.update([], { final: true }).stableText, state.text);

for (const text of ['Dr.', 'Mr.', 'e.g.', 'i.e.', 'U.S.', 'A.', '3.14', '12.']) assert.equal(endsSentence({text}), false, text);
for (const text of ['finished.', 'Really?', 'Done!”']) assert.equal(endsSentence({text}), true, text);
const titles = new SentenceMerger();
titles.update(words('Dr. Smith paid 3.14 dollars. Then left'));
state = titles.update(words('Dr. Smith paid 3.14 dollars. Then left'));
assert.equal(state.stableText, 'Dr. Smith paid 3.14 dollars.');
const context = new SentenceMerger();
const sentences = ['One.','Two.','Three.','Four'].map((text,i)=>({text,start_time:i,end_time:i+.5}));
context.update(sentences); context.update(sentences);
assert.equal(context.contextStart,1,'Keep two mature sentences as context.');
});

Then('speech inference coalesces jobs without losing audio or repeating Stop', async () => {
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const detector=()=>{let count=0;return pcm=>{const start=count/16000;count+=pcm.length;return[{start,end:count/16000,speech:true}]}};
const vocabulary=Array.from({length:130},(_,i)=>({text:`word${i}`,start_time:i*.4,end_time:i*.4+.3}));
let resolve,previous='',covered=0,calls=0,active=0,peak=0;
const done=new Promise(r=>resolve=r);
const decoder=new LiveDecoder({detect:detector(),infer:async(pcm,offset)=>{
  calls++;active++;peak=Math.max(peak,active);await wait(2);
  assert(offset<=covered,'Catch-up skipped unprocessed speech');covered=offset+pcm.length/16000;active--;
  return{words:vocabulary.filter(w=>w.start_time>=offset&&w.end_time<=covered)};
},update:r=>{assert(r.stableText.startsWith(previous));previous=r.stableText},finish:resolve,error:e=>{throw e}});
// Push faster than inference so catch-up and a 30-second window shift are exercised.
for(let i=0;i<104;i++)decoder.push(new Float32Array(8000));
decoder.end(new Float32Array(832000));const final=await done;
assert.equal(final.text,vocabulary.map(w=>w.text).join(' '));assert.equal(covered,52);assert.equal(peak,1);assert(calls<20);
let release,started=0,finish;
const completed=new Promise(r=>finish=r);
const slow=new LiveDecoder({detect:detector(),infer:async()=>{started++;if(started===1)await new Promise(r=>release=r);return{words:[]}},update:()=>{},finish,error:e=>{throw e}});
slow.push(new Float32Array(16000));await wait(10);
for(let i=0;i<10;i++)slow.push(new Float32Array(4000));assert.equal(started,1);
release();await wait(10);const beforeStop=started;slow.end(new Float32Array(56000));await completed;assert.equal(started,beforeStop,'Stop should flush cached pending text without another decode');
});

Then('continuous speech features preserve packet boundaries padding and RPC order', async () => {
const audio = Float32Array.from({ length: 128137 }, (_, i) => .2*Math.sin(i*.073)+.1*Math.sin(i*.019));
const full = new JsPreprocessor({ nMels: 128 });
const maxDelta = (a,b) => { assert.equal(a.length,b.length); let d=0; for(let i=0;i<a.length;i++) d=Math.max(d,Math.abs(a[i]-b[i])); return d; };
const live = new ContinuousFeatures();
for(let offset=0;offset<audio.length;offset+=997) live.push(audio.subarray(offset,offset+997));
assert.equal(live.frameComputations,live.frames,'Each complete raw frame computed exactly once while capturing.');
for(const end of [16000,24007,64000,128137]) {
  const actual = live.compute(0,end), expected = full.process(audio.subarray(0,end));
  assert.equal(actual.T,expected.length);
  assert(maxDelta(actual.features,expected.features)<2e-5,'Global features match full preprocessing including padded end.');
}
const whole = new ContinuousFeatures(); whole.push(audio);
for(const [start,end] of [[160,16000],[16000,64007],[32000,96000],[64000,128137]]) {
  const actual=live.compute(start,end), partition=whole.compute(start,end);
  assert.equal(maxDelta(actual.features,partition.features),0,'Capture partition must not change features.');
  // The first 2 frames retain real left context instead of fresh-window zeros.
  const raw = full.computeRawMel(audio.subarray(0,end));
  const T=actual.T, selected=new Float32Array(T*128);
  for(let m=0;m<128;m++) selected.set(raw.rawMel.subarray(m*raw.nFrames+start/160,m*raw.nFrames+start/160+T),m*T);
  assert(maxDelta(actual.features,full.normalizeFeatures(selected,T,T))<2e-5,'Moving-window continuous reference parity.');
  const fresh=full.process(audio.subarray(start,end));
  assert(maxDelta(actual.features,fresh.features)>1e-3,'Continuous left context deliberately differs from isolated-window padding.');
}
const computed=live.frames;
for(let start=0;start<80000;start+=1600) {
  const before=live.frameComputations;live.compute(start,start+32000);
  assert(live.frameComputations-before<=2,'Only provisional end frames may be recomputed.');
}
assert.equal(live.frames,computed,'Window requests cannot recompute committed raw frames.');
assert.equal(live.frames,Math.floor((audio.length-256)/160)+1);
assert.throws(()=>live.compute(3,16000),/aligned/);
assert.throws(()=>live.compute(0,audio.length+1),/available/);
const silent=new ContinuousFeatures(); silent.push(new Float32Array(32000));
assert(silent.compute(0,32000).features.every(v=>v===0),'Silence must normalize to finite zero.');
const reset=new ContinuousFeatures();reset.push(audio.subarray(0,16000));
assert(maxDelta(reset.compute(0,16000).features,full.process(audio.subarray(0,16000)).features)<2e-5);
assert.throws(()=>reset.push(new Float32Array(960001)),/60 seconds/);
// Exercise the actual MessagePort client/server, including cross-channel races.
const { MessageChannel } = await import('node:worker_threads');
const { FeaturesServer } = await import('./lib/speech/features.js');
const { LiveFeatures } = await import('./lib/speech/live-features.js');
const ownerChannel = new MessageChannel(), rpcChannel = new MessageChannel();
const server = new FeaturesServer(ownerChannel.port1);
ownerChannel.port2.postMessage({type:'init',nMels:128});
ownerChannel.port2.postMessage({type:'connect',port:rpcChannel.port1},[rpcChannel.port1]);
const rpc = new LiveFeatures(128,rpcChannel.port2);
const queued=rpc.compute(0,16000);
let resolved=false;queued.then(()=>{resolved=true;});
await new Promise(resolve=>setTimeout(resolve,15));
assert.equal(resolved,false,'Compute must wait when its independent PCM channel lags.');
ownerChannel.port2.postMessage({type:'push',pcm:audio.slice(0,8000)});
await new Promise(resolve=>setTimeout(resolve,15));
assert.equal(resolved,false,'Partial PCM must not resolve an unavailable feature range.');
ownerChannel.port2.postMessage({type:'push',pcm:audio.slice(8000,16000)});
const transportResult=await queued;
assert(maxDelta(transportResult.features,full.process(audio.subarray(0,16000)).features)<2e-5);
await assert.rejects(rpc.compute(0,960001),/60 seconds/);
const pending=rpc.compute(0,32000);
ownerChannel.port2.postMessage({type:'push',pcm:new Float32Array(960001)});
await assert.rejects(pending,/60 seconds/,'Capture failure must broadcast to waiting inference clients.');
rpc.close();ownerChannel.port1.close();ownerChannel.port2.close();
});
