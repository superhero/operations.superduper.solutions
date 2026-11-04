// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import {Then} from '@cucumber/cucumber';
import {expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createFixtureServer,waitForApplicationReady} from './legacy-smoke/support.mjs';

async function storageFixture(world) {
  const server=await createFixtureServer({}),base=`http://127.0.0.1:${server.httpServer.address().port}`;
  const block=8*1024*1024,large=Buffer.alloc(block+29);for(let i=0;i<large.length;i++)large[i]=i%251;
  const shared=Buffer.from('shared metadata'),small=Buffer.from('exact pinned tiny model');
  const file=(name,body,kind)=>({id:name,url:`https://model-fixtures.invalid/${name}`,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),kind});
  const a=file('a.gguf',large,'weights'),b=file('shared.json',shared,'data'),c=file('error.gguf',small,'weights');
  const profiles=[{id:'fixture-a',label:'Fixture model A',files:[a,b]},{id:'fixture-b',label:'Fixture model B',files:[b]},{id:'fixture-error',label:'Fixture model error',files:[c]}];
  const catalog=`export const storageProfiles=${JSON.stringify(profiles)};export function profileById(id){const p=storageProfiles.find(p=>p.id===id);if(!p)throw Error('Unknown fixture');return p;}export function artifactsFor(p){return profileById(p.id).files;}`;
  const state={mode:'good',requests:[],block:false};
  await world.context.route(`${base}/**`,route=>route.continue());
  await world.context.route(`${base}/lib/assistant/model-storage/catalog.ts*`,route=>route.fulfill({contentType:'application/javascript',body:catalog}));
  await world.context.route('https://model-fixtures.invalid/**',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'range'}});return;}
    state.requests.push(route.request().url());if(state.block){await route.abort('failed');return;}
    const descriptor=[a,b,c].find(item=>new URL(item.url).pathname===new URL(route.request().url()).pathname);
    if(state.mode==='retry'&&state.requests.length===1){await route.fulfill({status:503,body:'retry'});return;}
    const source=descriptor===a?large:descriptor===b?shared:small,range=route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/);
    const start=range?Number(range[1]):0,end=range?Number(range[2])+1:source.length;let body=Buffer.from(source.subarray(start,end));
    if(state.mode==='corrupt')body[0]^=1;if(state.mode==='truncated')body=body.subarray(0,body.length-1);
    await route.fulfill({status:range?206:200,headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range,content-length','cross-origin-resource-policy':'cross-origin',...(range?{'content-range':`bytes ${state.mode==='range'?start+1:start}-${end-1}/${source.length}`}:{})},body});
  });
  const initialize=async page=>{
    await page.goto(base,{waitUntil:'networkidle',timeout:60000});await waitForApplicationReady(page);
    await page.addScriptTag({type:'module',content:`import * as storage from '${base}/lib/assistant/model-storage/storage.ts';import * as runtime from '${base}/lib/assistant/model-storage/runtime.ts';import * as catalog from '${base}/lib/assistant/model-storage/catalog.ts';window.modelStore=storage;window.modelRuntime=runtime;window.modelCatalog=catalog;`});
    await page.waitForFunction(()=>!!window.modelStore);
  };
  await initialize(world.page);return{state,initialize,base,a,b,c,block};
}
const install=(page,id)=>page.evaluate(id=>window.modelStore.installModel(id,()=>{},new AbortController().signal),id);
const models=page=>page.evaluate(()=>window.modelStore.installedModels());

Then('model installation verifies complete bytes and cleans failed partial downloads',{timeout:90000},async function(){
  const {state,a,block}=await storageFixture(this),page=this.page;
  await install(page,'fixture-a');expect(await models(page)).toEqual(['fixture-a']);
  expect(await page.evaluate(async({file,block})=>[...new Uint8Array(await window.modelStore.readArtifact(file,block-3,block+7))],{file:a,block})).toEqual(Array.from({length:10},(_,i)=>(block-3+i)%251));
  await page.evaluate(()=>window.modelStore.removeModel('fixture-a'));
  for(const [mode,message]of[['corrupt','Checksum mismatch'],['range','pinned'],['truncated','before all pinned bytes']]){
    state.mode=mode;const error=await page.evaluate(async()=>{try{await window.modelStore.installModel('fixture-error',()=>{},new AbortController().signal);return'';}catch(error){return error.message;}});
    expect(error).toContain(message);expect(await models(page)).toEqual([]);
    expect(await page.evaluate(async()=>{const db=await window.modelStore.modelDatabase();try{return await db.count('blocks');}finally{db.close();}})).toBe(0);
  }
  state.mode='retry';state.requests=[];await install(page,'fixture-error');expect(state.requests).toHaveLength(2);await page.evaluate(()=>window.modelStore.removeModel('fixture-error'));
  state.mode='good';
  const canceled=await page.evaluate(async block=>{const cancel=new AbortController();try{await window.modelStore.installModel('fixture-a',event=>{if(event.received>block)cancel.abort();},cancel.signal);return'';}catch(error){return error.name;}},block);
  expect(canceled).toBe('AbortError');expect(await models(page)).toEqual([]);
  const quota=await page.evaluate(async()=>{const put=IDBObjectStore.prototype.put;let writes=0;IDBObjectStore.prototype.put=function(...args){if(this.name==='blocks'&&++writes===2)throw new DOMException('Fixture storage quota exhausted','QuotaExceededError');return put.apply(this,args);};try{await window.modelStore.installModel('fixture-a',()=>{},new AbortController().signal);return'';}catch(error){return error.message;}finally{IDBObjectStore.prototype.put=put;}});
  const expectedRetry=this.diagnostics.filter(item=>item.type==='http-error'&&item.status===503&&item.url.startsWith('https://model-fixtures.invalid/error.gguf?')||item.type==='console-error'&&item.message.includes('503')&&item.location?.url?.startsWith('https://model-fixtures.invalid/error.gguf?'));
  expect(expectedRetry.map(item=>item.type).sort()).toEqual(['console-error','http-error']);this.diagnostics=this.diagnostics.filter(item=>!expectedRetry.includes(item));
  expect(quota).toContain('ran out of storage');expect(await models(page)).toEqual([]);
  expect(await page.evaluate(async()=>{const db=await window.modelStore.modelDatabase();try{return[await db.count('blocks'),await db.count('artifacts')];}finally{db.close();}})).toEqual([0,0]);
});

Then('model file leases protect logical use and shared assets across tabs',{timeout:90000},async function(){
  const fixture=await storageFixture(this),page=this.page,other=await this.context.newPage();
  try{
    await fixture.initialize(other);await other.evaluate(()=>{window.modelChanges=0;window.stopModelSubscription=window.modelStore.subscribeModels(()=>window.modelChanges++);});
    await install(page,'fixture-a');await expect.poll(()=>other.evaluate(()=>window.modelChanges)).toBeGreaterThan(0);await install(other,'fixture-b');
    for(const target of[page,other])await target.evaluate(async()=>{window.releaseModelUse=await window.modelStore.acquireModelUse('fixture-a');});
    const removal=()=>other.evaluate(async()=>{try{await window.modelStore.removeModel('fixture-a');return'';}catch(error){return error.message;}});
    expect(await removal()).toContain('Unload');await page.evaluate(()=>window.releaseModelUse());expect(await removal()).toContain('Unload');
    await other.evaluate(()=>window.releaseModelUse());await other.evaluate(()=>window.modelStore.removeModel('fixture-a'));expect(await models(other)).toEqual(['fixture-b']);
    expect(await other.evaluate(async file=>new TextDecoder().decode(await window.modelStore.readArtifact(file)),fixture.b)).toBe('shared metadata');
    await page.evaluate(()=>{window.holdInstall=navigator.locks.request('operations-ai-model-install-v1',async()=>new Promise(resolve=>window.releaseInstall=resolve));});
    await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).held.some(lock=>lock.name==='operations-ai-model-install-v1'))).toBe(true);
    const before=fixture.state.requests.length;
    expect(await other.evaluate(async()=>{const stop=new AbortController();const waiting=window.modelStore.installModel('fixture-error',()=>{},stop.signal);stop.abort();try{await waiting;return'';}catch(error){return error.name;}})).toBe('AbortError');expect(fixture.state.requests).toHaveLength(before);
    await page.evaluate(async()=>{window.releaseInstall();await window.holdInstall;});
    await other.evaluate(async()=>{window.releaseModelUse=await window.modelStore.acquireModelUse('fixture-b');});await other.close();
    await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).held.some(lock=>lock.name==='operations-ai-model-use-v1:fixture-b'))).toBe(false);
    await page.evaluate(()=>window.modelStore.removeModel('fixture-b'));expect(await models(page)).toEqual([]);
  }finally{await other.close();}
});

Then('saved model files and local image bytes load without publisher requests',{timeout:90000},async function(){
  const fixture=await storageFixture(this),page=this.page;
  expect(fixture.state.requests).toEqual([]);await install(page,'fixture-a');
  await page.getByRole('banner').getByRole('button',{name:'AI assistant',exact:true}).click();
  await page.getByRole('region',{name:'Browser assistant',exact:true}).getByRole('button',{name:'Assistant configuration',exact:true}).click();
  const config=page.locator('#assistant-configuration-panel');await config.locator('summary').filter({hasText:/^Model storage/}).click();
  await expect(config.getByRole('list',{name:'Verified model files'})).toContainText('Fixture model A');
  await page.evaluate(async()=>{window.releaseFixture=await window.modelStore.acquireModelUse('fixture-a');});
  await config.getByRole('button',{name:'Remove Fixture model A',exact:true}).click();await expect(config.getByRole('alert')).toContainText('Unload');await page.evaluate(()=>window.releaseFixture());
  for(const width of[390,320]){await page.setViewportSize({width,height:844});expect(await page.locator('#settings-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
  await page.screenshot({path:this.artifactDirectory+'/model-storage-320.png'});
  fixture.state.block=true;fixture.state.requests=[];
  const result=await page.evaluate(async({base,file})=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;canvas.getContext('2d').fillRect(0,0,1,1);const image=canvas.toDataURL();
    async function read(){
      const source=`import {modelAssetFetch} from '${base}/lib/assistant/model-storage/runtime.ts';globalThis.fetch=modelAssetFetch('fixture-a');self.onmessage=async({data})=>{try{const bytes=await(await fetch(data.url,{headers:{Range:'bytes=8388605-8388614'}})).arrayBuffer();const picture=await createImageBitmap(await(await fetch(data.image)).blob());const unknown=await fetch('https://model-fixtures.invalid/unpinned');postMessage({bytes:[...new Uint8Array(bytes)],image:[picture.width,picture.height],unknown:unknown.status});picture.close();}catch(error){postMessage({error:error.message});}};`;
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
      try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cached reader worker timed out')),15000);worker.onerror=event=>{event.preventDefault();clearTimeout(timer);reject(Error(event.message));};worker.onmessage=event=>{clearTimeout(timer);resolve(event.data);};worker.postMessage({url:file.url+'?browser_range=8388605-8388614',image});});}
      finally{worker.terminate();URL.revokeObjectURL(url);}
    }
    const first=await read();const db=await window.modelStore.modelDatabase();try{await db.delete('blocks',[file.sha256,0]);}finally{db.close();}let directError='';try{await window.modelStore.readArtifact(file,0,1);}catch(error){directError=error.message;}const missing=await read();return{first,missing,directError};
  },{base:fixture.base,file:fixture.a});
  expect(result.first).toEqual({bytes:Array.from({length:10},(_,i)=>(fixture.block-3+i)%251),image:[1,1],unknown:404});expect(fixture.state.requests).toEqual([]);expect(result.directError).toContain('missing');expect(result.missing.error).toBeTruthy();await config.getByRole('button',{name:'Remove Fixture model A',exact:true}).click();await expect(config).toContainText('No model files have been verified and saved yet.');
});
