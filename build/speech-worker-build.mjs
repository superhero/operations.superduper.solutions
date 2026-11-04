// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {resolve} from 'node:path';
import {prepareNqSpeech} from './prepare-nq-speech.mjs';
import {parakeetSerialInitialization} from './parakeet-plugin.mjs';
export async function speechWorkerBuildOptions(outDir,entry,{write=true,inlineDynamicImports=false,generationDirectory}={}){
  const aliases=await prepareNqSpeech({directory:generationDirectory});
  return{configFile:false,publicDir:false,plugins:[parakeetSerialInitialization()],
    resolve:{conditions:['onnxruntime-web-use-extern-wasm','module','browser','production'],alias:[...Object.entries(aliases).map(([find,replacement])=>({find,replacement})),
      {find:/^onnxruntime-web$/,replacement:resolve('node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs')},
      {find:/^onnxruntime-web\/webgpu$/,replacement:resolve('node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs')}]},
    build:{target:'es2024',outDir,emptyOutDir:false,write,lib:{entry,formats:['es']},
      rollupOptions:{output:{entryFileNames:'[name].js',chunkFileNames:'chunks/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]',
        ...(inlineDynamicImports?{inlineDynamicImports:true}:{})}}}};
}
