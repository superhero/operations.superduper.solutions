// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from '@playwright/test';
import { compactSchemaPacks } from '../../build/schema-pack-plugin.mjs';
import { compactInlineWorkers } from '../../build/inline-worker-plugin.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),directory=resolve(root,'tmp/test/credential-results-ui');
await mkdir(directory,{recursive:true});let server,browser;const errors=[];let mockedProviderRequests=0;
const packedWorkerPrograms=[];
try {
  const built=await build({root,configFile:false,logLevel:'error',plugins:[svelte(),compactSchemaPacks(),compactInlineWorkers({onPacked:record=>packedWorkerPrograms.push(record)})],resolve:{alias:{$lib:resolve(root,'src/lib')}},
    worker:{format:'iife',plugins:()=>[compactSchemaPacks()]},build:{write:false,target:'es2024',minify:true,lib:{entry:resolve(root,'tests/credential-results/ui.fixture.ts'),formats:['es']}}});
  assert.ok(packedWorkerPrograms.some(record=>record.id.includes('/secrets/vault.worker.ts?worker&inline')),'The browser proof must use a compressed vault worker.');
  const output=Array.isArray(built)?built[0]:built,files=new Map(output.output.map(file=>['/'+file.fileName,file.type==='chunk'?file.code:file.source]));
  files.set('/fixture.js',output.output.find(file=>file.type==='chunk'&&file.isEntry).code);
  server=createServer((request,response)=>{const path=new URL(request.url,'http://localhost').pathname;
    response.setHeader('Cross-Origin-Opener-Policy','same-origin');response.setHeader('Cross-Origin-Embedder-Policy','credentialless');
    if(path==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Private credential-result controls</title><script type="module">window.privateResultUi=await import("/fixture.js");</script>');}
    else if(files.has(path)){response.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':path.endsWith('.css')?'text/css':'text/javascript');response.end(files.get(path));}
    else{response.statusCode=404;response.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',async route=>{const url=route.request().url();
    if(url==='https://api.elevenlabs.io/v1/productions/orders/prodorder_'+'a'.repeat(26)+'/media/prodmedia_'+'b'.repeat(26)){mockedProviderRequests++;assert.equal(route.request().method(),'GET');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signed_url:'https://signed.example.test/private-browser-result-724190',name:'Signed media',content_type:'audio/mpeg'})});return;}
    if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))await route.continue();else{errors.push('Unexpected external request');await route.abort();}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
  await page.waitForFunction(()=>!!window.privateResultUi,undefined,{timeout:120000});await page.evaluate(()=>window.privateResultUi.initialize());
  await page.getByRole('combobox',{name:'Authentication alternative',exact:true}).click();
  await page.getByRole('option',{name:'Without credentials',exact:true}).click();
  await page.waitForFunction(()=>!!window.privateResultUi.currentBinding(),undefined,{timeout:30000});
  const binding=await page.evaluate(()=>window.privateResultUi.currentBinding());assert.equal(binding.alternative,0);assert.deepEqual(binding.credentials,{});
  await page.getByText('Returned credentials are saved in Secrets.',{exact:false}).waitFor();
  const input=page.locator('[id="private-input-body:access_token"]');assert.equal(await input.isDisabled(),true);
  await page.getByText('Connect a Secrets node to supply this value privately.',{exact:true}).first().waitFor();
  await page.evaluate(()=>window.privateResultUi.lock());await page.waitForFunction(()=>window.privateResultUi.currentBinding()===null);
  await page.getByRole('button',{name:'Unlock',exact:true}).waitFor();
  await page.evaluate(()=>window.privateResultUi.unlock());await page.getByRole('button',{name:'Refresh credentials',exact:true}).click();
  await page.waitForFunction(()=>!!window.privateResultUi.currentBinding());assert.deepEqual(await page.evaluate(()=>window.privateResultUi.currentBinding().credentials),{});
  const worker = await page.evaluate(()=>window.privateResultUi.acquire());assert.equal(worker.workerAdoption,true);assert.equal(mockedProviderRequests,1);
  await page.evaluate(()=>window.privateResultUi.cleanup());assert.deepEqual(errors,[]);
  await writeFile(resolve(directory,'result.json'),JSON.stringify({passed:true,workerFormat:'iife',anonymousBindingRequiresUnlockedVault:true,lockRevokesBinding:true,unlockRefreshRestoresBinding:true,plaintextTokenInputDisabled:true,...worker,mockedProviderRequests,externalRequests:0,pageErrors:0,packedWorkerPrograms},null,2)+'\n');
  console.log('Private-result browser controls passed: real vault create/lock/unlock, anonymous binding and private input controls.');
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
