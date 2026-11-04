// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {Then} from '@cucumber/cucumber';
import {expect} from '@playwright/test';
import {createFixtureServer,waitForApplicationReady} from './legacy-smoke/support.mjs';
import {setMode} from './workspace.fixture.mjs';
async function development(world,work){
  const server=await createFixtureServer({}),url=`http://127.0.0.1:${server.httpServer.address().port}`,allow=route=>route.continue();
  await world.context.route(`${url}/**`,allow);
  try{await world.page.goto(url,{waitUntil:'networkidle',timeout:60000});await waitForApplicationReady(world.page);return await work();}
  finally{await world.page.goto('about:blank');await world.context.unroute(`${url}/**`,allow);await server.close();}
}
Then('continuous audio storage retains thirty segments as one recording and exports exact cores',{timeout:90000},async function(){
  const result=await development(this,()=>this.page.evaluate(async()=>{
    const {createSegmentStore}=await import('/lib/speech/continuous/segment-store.js'),{recordingAudio}=await import('/lib/speech/continuous/recordings.js');
    const {saveRecording,listRecordings}=await import('/lib/speech/storage.js'),store=createSegmentStore({name:'operations-speech-segments-v1'});
    const record={id:'one-long-recording',created:'2026-01-01T00:00:00.000Z',status:'complete',metadata:{continuous:true},audio:new Blob([]),partials:[],events:[],final:{text:''},expected:'',signal:{}};
    for(let index=0;index<30;index++){
      const core=index*2,start=Math.max(0,core-1),end=core+2;
      await store.put({recordingId:record.id,sessionId:record.id+'-'+index,index,created:record.created,status:'complete',
        reason:index===29?'stop':'rotation',audioStartSample:start,coreStartSample:core,endSample:end,pcm:Float32Array.from({length:end-start},(_,i)=>start+i),transcript:{words:[]}});
    }
    await saveRecording(record);
    for(let index=0;index<19;index++)await saveRecording({...record,id:'other-'+index,created:`2026-01-${String(index+2).padStart(2,'0')}T00:00:00.000Z`,metadata:{},audio:new Blob([])});
    const originalGet=IDBObjectStore.prototype.get;let audioReads=0;
    IDBObjectStore.prototype.get=function(...args){if(this.name==='audio')audioReads++;return originalGet.apply(this,args);};
    try{
      const listed=await listRecordings(),listingAudioReads=audioReads,rows=await store.list(record.id);
      const wav=await(await recordingAudio(record)).arrayBuffer(),view=new DataView(wav),samples=Array.from({length:60},(_,index)=>view.getFloat32(44+4*index,true));
      await saveRecording({...record,id:'twentieth-other',created:'2026-02-01T00:00:00.000Z',metadata:{},audio:new Blob([])});
      const removed=(await store.list(record.id)).length;
      return{records:listed.length,segments:rows.length,listingAudioReads,samples,bytes:wav.byteLength,removed};
    }finally{IDBObjectStore.prototype.get=originalGet;await store.close();}
  }));
  expect(result.records).toBe(20);expect(result.segments).toBe(30);expect(result.listingAudioReads).toBe(0);
  expect(result.samples).toEqual(Array.from({length:60},(_,index)=>index));expect(result.bytes).toBe(284);expect(result.removed).toBe(0);
});
Then('continuous recovery audio and its sample hash survive a reload',{timeout:90000},async function(){
  await development(this,async()=>{
    const before=await this.page.evaluate(async()=>{
      const {createSegmentStore}=await import('/lib/speech/continuous/segment-store.js'),store=createSegmentStore({name:'operations-speech-segments-v1'});
      await store.put({recordingId:'unfinished',sessionId:'unfinished-0',index:0,created:'2026-01-01T00:00:00.000Z',status:'pending',reason:'cancel',audioStartSample:0,coreStartSample:0,endSample:3,pcm:Float32Array.of(.125,-.5,.75)});await store.close();
      const {recordingAudio}=await import('/lib/speech/continuous/recordings.js');const bytes=await(await recordingAudio({id:'unfinished',metadata:{continuous:true}})).arrayBuffer();
      return[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice(44)))];
    });
    await this.page.reload({waitUntil:'networkidle'});await waitForApplicationReady(this.page);
    const after=await this.page.evaluate(async()=>{
      const {listRecordings}=await import('/lib/speech/storage.js'),{recordingAudio}=await import('/lib/speech/continuous/recordings.js');
      const record=(await listRecordings()).find(row=>row.id==='unfinished');if(!record)throw Error('Unfinished recording was not recovered');
      const bytes=await(await recordingAudio(record)).arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice(44)))];
      await new Promise((resolve,reject)=>{const request=indexedDB.open('operations-speech-segments-v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete('unfinished-0');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
      let missing;try{await recordingAudio(record);}catch(error){missing=error.message;}
      const {createSegmentStore}=await import('/lib/speech/continuous/segment-store.js'),store=createSegmentStore({name:'operations-speech-segments-v1'});const retained=(await store.list('unfinished')).length;await store.close();
      return{recovered:record.metadata.recovered,hash,missing,retained};
    });expect(after.recovered).toBe(true);expect(after.hash).toEqual(before);expect(after.missing).toContain('incomplete');expect(after.retained).toBe(1);
  });
});
Then('the real continuous speech worker runs in production and development without page globals',{timeout:90000},async function(){
  const models=[];this.page.on('request',request=>{if(/huggingface\.co|code\.superduper\.solutions/.test(request.url()))models.push(request.url());});
  const check=()=>this.page.evaluate(()=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./speech/continuous-worker.js',document.baseURI),{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('Speech worker import timed out'));},30000);
    worker.onerror=event=>{event.preventDefault();clearTimeout(timer);worker.terminate();reject(Error(event.message));};
    worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timer);worker.terminate();resolve(data.message);}};
    worker.postMessage({type:'unknown-fixture-command',requestId:1});
  }));
  expect(await check()).toContain('Unknown continuous speech command');
  await development(this,async()=>{expect(await check()).toContain('Unknown continuous speech command');});expect(models).toEqual([]);
});

Then('continuous controls omit legacy refinement and release prepared playback audio',{timeout:90000},async function(){
  const page=this.page;await development(this,async()=>{
    await page.evaluate(async()=>{
      const{saveRecording}=await import('/lib/speech/storage.js'),{createSegmentStore}=await import('/lib/speech/continuous/segment-store.js'),{wav}=await import('/lib/speech/diagnostics.js');
      const base={status:'complete',events:[],partials:[],expected:'',signal:{},final:{text:'Saved audio'}};
      await saveRecording({...base,id:'legacy-ui',created:'2026-01-01T00:00:00.000Z',metadata:{continuous:false},audio:wav([Float32Array.of(.1,.2)])});
      await saveRecording({...base,id:'continuous-ui',created:'2026-02-01T00:00:00.000Z',metadata:{continuous:true},audio:new Blob([])});
      const store=createSegmentStore({name:'operations-speech-segments-v1'});await store.put({recordingId:'continuous-ui',sessionId:'continuous-ui-0',index:0,status:'complete',reason:'stop',audioStartSample:0,coreStartSample:0,endSample:2,pcm:Float32Array.of(.3,.4)});await store.close();
      localStorage.setItem('v1/settings/speech',JSON.stringify({mode:'gpu-continuous',restore:false,loaded:false}));
    });
    await page.reload({waitUntil:'networkidle'});await waitForApplicationReady(page);
    await page.evaluate(()=>{window.revokedSpeechUrls=[];const original=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revokedSpeechUrls.push(url);original(url);};});
    await setMode(page,'settings');const mode=page.getByRole('switch',{name:'AI assistant',exact:true});if(await mode.getAttribute('aria-checked')==='true')await mode.click();
    const ai=page.locator('summary[aria-label="AI"]');if(await ai.getAttribute('aria-expanded')!=='true')await ai.click();
    const speech=page.locator('.speech-settings');if(await speech.getAttribute('open')!=='')await speech.locator(':scope > summary').click();
    await expect(speech.getByRole('checkbox',{name:'Refine the whole recording after Stop',exact:true})).toHaveCount(0);
    await speech.locator('summary').filter({hasText:/^Local speech diagnostics/}).click();
    const audio=speech.getByLabel('Saved speech recording',{exact:true}),prepare=speech.getByRole('button',{name:'Prepare saved audio for playback',exact:true});
    await expect(audio).toHaveCount(0);await prepare.click();await expect(audio).toBeVisible();const first=await audio.getAttribute('src');expect(first).toMatch(/^blob:/);
    const recordings=speech.getByRole('combobox',{name:'Saved speech recordings',exact:true});await recordings.click();await page.getByRole('option').nth(1).click();
    await expect.poll(()=>page.evaluate(url=>window.revokedSpeechUrls.includes(url),first)).toBe(true);await expect(audio).toBeVisible();expect(await audio.getAttribute('src')).not.toBe(first);
    await recordings.click();await page.getByRole('option').nth(0).click();await expect(audio).toHaveCount(0);await prepare.click();await expect(audio).toBeVisible();const second=await audio.getAttribute('src');
    await speech.getByRole('button',{name:'Delete saved recordings',exact:true}).click();await expect(speech).toContainText('No saved recordings.');
    await expect.poll(()=>page.evaluate(url=>window.revokedSpeechUrls.includes(url),second)).toBe(true);
  });
});
