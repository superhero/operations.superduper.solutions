// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {createReadStream} from 'node:fs';
import {readFile as readBytes,readdir as entries} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {speechWorkerBuildOptions} from './speech-worker-build.mjs';
async function sourceFiles(root,directory){
  const found=[];for(const entry of await entries(resolve(root,directory),{withFileTypes:true})){
    const path=directory+'/'+entry.name;
    if(entry.isDirectory())found.push(...await sourceFiles(root,path));else if(/\.(?:js|mjs|json|ts|wasm)$/.test(path))found.push(path);
  }return found;
}
export function speechRuntimeDevelopment(){
  let queue=Promise.resolve(),cachedKey,cached;
  return{name:'operations-continuous-speech-worker',apply:'serve',configureServer(server){
    server.middlewares.use('/speech',async(request,response,next)=>{
      const path=(request.url??'/').split('?')[0],root=resolve(server.config.root,'..');
      if(path==='/capture-worklet.js'){response.setHeader('Content-Type','text/javascript');createReadStream(resolve(root,'src/lib/speech/capture-worklet.js')).on('error',next).pipe(response);return;}
      if(cached?.assets.has(path)){for(const[name,value]of Object.entries(server.config.server.headers??{}))response.setHeader(name,value);response.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'text/javascript');response.end(cached.assets.get(path));return;}
      if(path!=='/continuous-worker.js')return next();
      const compile=queue.then(async()=>{
        const files=[...await sourceFiles(root,'src/lib/speech'),...await sourceFiles(root,'src/lib/assistant/model-storage'),
          ...await sourceFiles(root,'build/speech/nq'),'src/lib/assistant/language-profiles.json','src/lib/assistant/vision-profile.json',
          'src/lib/assistant/vision-compatible-profile.json','src/lib/assistant/decision-profiles.json','src/lib/assistant/runtime-ownership.js','src/lib/assistant/config.ts','src/lib/assistant/compatibility.ts','src/lib/assistant/vision-profiles.ts',
          'package-lock.json','build/speech-worker-build.mjs','build/prepare-nq-speech.mjs'];
        const signature=async()=>{const hash=createHash('sha256');for(const file of files.sort()){hash.update(file);hash.update(await readBytes(resolve(root,file)));}return hash.digest('hex');};
        const key=await signature();if(key===cachedKey)return cached;
        const {build}=await import('vite'),result=await build({...await speechWorkerBuildOptions(resolve(server.config.cacheDir,'operations-speech'),
          {'continuous-worker':resolve(root,'src/lib/speech/continuous/worker.js')},{write:false,inlineDynamicImports:true,generationDirectory:resolve(server.config.cacheDir,'operations-speech-generated')}),logLevel:'warn'});
        const output=(Array.isArray(result)?result:[result]).flatMap(bundle=>bundle.output),chunks=output.filter(item=>item.type==='chunk');
        if(chunks.length!==1||!chunks[0].isEntry)throw Error('Continuous speech must compile into one isolated development worker.');
        if(await signature()!==key)throw Error('Continuous speech sources changed during compilation. Retry the request.');
        cached={code:chunks[0].code,assets:new Map(output.filter(item=>item.type==='asset').map(item=>['/'+item.fileName,item.source]))};cachedKey=key;return cached;
      });
      queue=compile.then(()=>{},()=>{});
      try{const code=await compile;for(const[name,value]of Object.entries(server.config.server.headers??{}))response.setHeader(name,value);
        response.setHeader('Content-Type','text/javascript');response.end(code.code);}catch(error){next(error);}
    });
  }};
}
