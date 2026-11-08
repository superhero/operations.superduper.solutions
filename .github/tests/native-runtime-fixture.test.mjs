// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {basename,dirname} from 'node:path';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';

Then('the native browser fixture reports missing qualification pins without exposing runtime authority', {timeout:10000}, async function(){
  const {createNativeBrowserEndpoint}=await import('../../tests/browser/native-runtime.fixture.mjs');
  const names=['OPERATIONS_CODEX_QUALIFICATION_BINARY','OPERATIONS_CODEX_QUALIFICATION_SHA256'];
  const previous=names.map(name=>[name,process.env[name]]),endpoint=createNativeBrowserEndpoint();
  const server=createServer((request,response)=>{if(!endpoint.handle(request,response)){response.writeHead(404);response.end();}});
  try{
    for(const name of names)delete process.env[name];
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const response=await fetch(`http://127.0.0.1:${server.address().port}/native-companion-fixture/${randomUUID()}/create`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({real:true}),
    });
    assert.equal(response.status,500);assert.equal(response.headers.get('Content-Type'),'application/json');
    assert.deepEqual(await response.json(),{error:'native_fixture_unavailable',
      message:'Real native browser fixtures require the pinned Codex binary and SHA-256. Missing: '+names.join(', '),missing:names});
  }finally{
    for(const [name,value]of previous){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    try{await endpoint.close();}finally{
      server.closeAllConnections();
      if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  }
  assert.equal(server.listening,false);assert.ok(previous.every(([name,value])=>process.env[name]===value));
});

Then('the native browser fixture identifies sandbox setup failures without publishing private SDK exceptions', {timeout:10000}, async function(){
  const names=['OPERATIONS_CODEX_QUALIFICATION_BINARY','OPERATIONS_CODEX_QUALIFICATION_SHA256'];
  const previous=names.map(name=>[name,process.env[name]]),directories=new Set(),privateAuthority='OWNED_PRIVATE_SDK_AUTHORITY_6831';
  let endpoint,server,failure,closed=0;
  try{
    process.env[names[0]]='owned-diagnostic-executable-never-started';process.env[names[1]]='1'.repeat(64);
    vi.doMock('../../tests/native-stored-thread-sdk.fixture.mjs',()=>({async nativeStoredThreadSdkFixture({home}){
      const directory=dirname(home);assert.match(basename(directory),/^operations-native-browser-/);directories.add(directory);
      return {calls:[{method:'thread/start'}],async seed(){throw failure;},async close(){closed++;}};
    }}));
    const {createNativeBrowserEndpoint}=await import('../../tests/browser/native-runtime.fixture.mjs?sandbox-setup-diagnostic');
    endpoint=createNativeBrowserEndpoint();server=createServer((request,response)=>{if(!endpoint.handle(request,response)){response.writeHead(404);response.end();}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const cases=[
      {detail:'fs sandbox helper failed: bwrap: No permissions to create a new namespace.',code:'NATIVE_SANDBOX_NAMESPACE_DENIED',
        message:'The pinned Codex SDK could not create its filesystem sandbox namespace.',sdkCode:-32603},
      {detail:'bwrap: Failed RTM_NEWADDR: Operation not permitted.',code:'NATIVE_SANDBOX_PERMISSION_DENIED',
        message:'The pinned Codex SDK filesystem sandbox setup was denied permission.',sdkCode:-32603},
      {detail:'Unclassified private SDK failure.',code:'NATIVE_STORED_THREAD_SETUP_FAILED',
        message:'The pinned Codex SDK could not prepare the owned stored-thread fixture.'},
    ];
    for(const [index,item]of cases.entries()){
      failure=Object.assign(new Error(item.detail+' '+privateAuthority+' /owned/private/AGENTS.md'),{code:item.sdkCode??privateAuthority});
      const response=await fetch(`http://127.0.0.1:${server.address().port}/native-companion-fixture/${randomUUID()}/create`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({real:true,threadsRead:true}),
      });
      assert.equal(response.status,500);const diagnostic=await response.json();
      assert.deepEqual(diagnostic,{error:'native_fixture_unavailable',message:item.message,phase:'stored-thread.seed',code:item.code,
        method:'thread/start',...(item.sdkCode===undefined?{}:{sdkCode:item.sdkCode})});
      assert.ok(!JSON.stringify(diagnostic).includes(privateAuthority));assert.equal(closed,index+1);
    }
  }finally{
    for(const [name,value]of previous){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    vi.doUnmock('../../tests/native-stored-thread-sdk.fixture.mjs');
    try{await endpoint?.close();}finally{
      try{
        server?.closeAllConnections();
        if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      }finally{for(const directory of directories)await rm(directory,{recursive:true,force:true});}
    }
  }
  assert.equal(server.listening,false);assert.ok(previous.every(([name,value])=>process.env[name]===value));
});
