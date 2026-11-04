// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Portable editor entry point for the reference's unchanged compatibility conversion.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
if(process.argv.length!==4)throw Error('Usage: node build/speech/conversion/convert.mjs SOURCE_DECODER OUTPUT_DECODER');
const source=resolve(process.argv[2]),target=resolve(process.argv[3]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [name,version] of [['onnxruntime-web','1.30.0'],['protobufjs','7.6.6']]){
  if(JSON.parse(await readFile(resolve(root,'node_modules',name,'package.json'),'utf8')).version!==version)throw Error('Run the editor npm ci with the pinned lockfile: '+name);
}
const parser=await readFile(resolve(root,'node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js'));
if(sha(parser)!=='b6cb83ec708b51f5bcce8295a2dc1452e430d6c8696db2da68c5233d9359cb3f')throw Error('ONNX parser pin differs.');
await mkdir(resolve(root,'tmp/build'),{recursive:true});
const stage=await mkdtemp(resolve(root,'tmp/build/speech-conversion-'));
try{
  await writeFile(resolve(stage,'onnx.cjs'),parser);
  await writeFile(resolve(stage,'lower-decoder.cjs'),await readFile(resolve(here,'lower-decoder.cjs')));
  const run=spawnSync(process.execPath,[resolve(stage,'lower-decoder.cjs'),source,target],{cwd:stage,encoding:'utf8',maxBuffer:4*1024*1024});
  if(run.error)throw run.error;
  if(run.status!==0)throw Error(run.stderr||'Decoder conversion failed.');
  const bytes=await readFile(target);
  if(bytes.length!==18195496||sha(bytes)!=='8a8957dbe0eb8dcb49fac13f5b2db42e7c448a4dd10a24d27e0fc32189a8ec26')throw Error('Converted decoder differs from the qualified graph.');
  console.log(JSON.stringify({output:target,bytes:bytes.length,sha256:sha(bytes),inferenceExecuted:false}));
}finally{await rm(stage,{recursive:true,force:true});}
