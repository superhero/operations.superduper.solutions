// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Then} from '@cucumber/cucumber';

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
