// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {nativeHostFixture} from '../tests/native-runtime.fixture.mjs';
import {nativeVaultFixture} from '../tests/native-vault.fixture.mjs';
import {nativeReference} from './lib/secrets/native-runtime-config.ts';
import {nativeConfigurationWriteHash} from './lib/native-configuration-write.ts';
import {waitForWatch} from '../tests/native-watch-transport.fixture.mjs';
import {nativeMigrationCompleted} from './lib/native-migration.ts';
import {readServiceSchema} from './lib/service-schema-packs.ts';
import {nativeRpcOperation,scopeNativeRpcSchema} from './lib/native-rpc.ts';
import {nativeInitializeParams} from './lib/native-initialize.ts';
import {VaultError} from './lib/secrets/types.ts';
import {reviewNativeValueStrings} from './lib/secrets/native-value-review.ts';

// The paired transport is real; the broker effect verifier is the unit boundary.
// SDK execution remains in tests/evaluations/native-configuration-write.feature.
async function context(run,method='config/value/write',transport=false,editFrames) {
  const importing=method==='externalAgentConfig/import';
  let v,c;
  const f=await nativeHostFixture({allowConfigurationWrite:true,allowMigration:importing,requiresOpenaiAuth:false,
    configureRuntime(runtime,owned){
      if(!transport)return;
      runtime.prepareConfigurationWrite=async(method,params)=>({method,params:structuredClone(params),before:{identity:structuredClone(owned.identity)}});
      runtime.reviewConfigurationWrite=async(plan,result)=>{
        await c.beforeVerify?.(plan,result);
        owned.identity.configuration=c.nextConfiguration??'c'.repeat(64);
        return {identity:structuredClone(owned.identity),result:structuredClone(result)};
      };
      runtime.configurationWriteAuthority=async()=>structuredClone(owned.identity);
      runtime.prepareMigration=async(method,params)=>({method,params:structuredClone(params),before:{identity:structuredClone(owned.identity)}});
      runtime.dispatchMigration=async plan=>structuredClone(plan.params);
      runtime.reviewMigration=async(plan,result,completion)=>{
        await c.beforeVerify?.(plan,result,completion);
        owned.identity.configuration=c.nextConfiguration??'c'.repeat(64);
        return {identity:structuredClone(owned.identity),result:structuredClone(result),effectHash:'e'.repeat(64),privateValues:c.privateValues??[]};
      };
      runtime.migrationAuthority=async()=>structuredClone(owned.identity);
      runtime.finishMigration=()=>{owned.finishedImports=(owned.finishedImports??0)+1;};
      runtime.abortMigration=()=>{owned.abortedImports=(owned.abortedImports??0)+1;};
    },
    onFrame(frame,_owned,receive){
      if(!transport||frame.method!==method)return false;
      queueMicrotask(()=>receive({id:frame.id,result:structuredClone(c.result)}));
      if(importing)queueMicrotask(()=>receive({method:nativeMigrationCompleted,params:{importId:c.result.importId,
        itemTypeResults:[{itemType:'CONFIG',successes:[{itemType:'CONFIG'}],failures:[]}]}}));
      return true;
    }});
  try {
    if(editFrames){
      const Socket=f.runtime.WebSocket;
      f.runtime.WebSocket=class extends Socket{
        addEventListener(name,listener,options){
          if(name!=='message')return super.addEventListener(name,listener,options);
          return super.addEventListener(name,event=>{for(const frame of editFrames(JSON.parse(event.data)))listener({data:JSON.stringify(frame)});},options);
        }
      };
    }
    v=await nativeVaultFixture(f);const selections=await v.workflowSelections(),connection=await v.session.pairNativeRuntime(v.input,v.selection);
    c={f,v,selections,connection,reference:nativeReference(connection),callbacks:[],calls:0};
    c.selection=selections.find(s=>s.operation.rpc.method===method);
    c.input=importing?{migrationItems:[{itemType:'CONFIG',description:'Owned source fixture'}]}:{keyPath:'model',value:'owned-source-fixture',mergeStrategy:'replace'};
    c.result=importing?{importId:crypto.randomUUID()}:{status:'ok',version:'owned-version',filePath:'/public/fixture/config.toml'};
    c.execute=(reference=c.reference,signal)=>v.session.executeNativeRuntime(reference,selections,c.selection,c.input,signal,undefined,next=>{c.callbacks.push(next);c.reference=next;});
    if(!transport)v.session.nativeAgent.execute=async(connection,_key,_workflow,method,params,_guard,_signal,_progress,adoptConfiguration,adoptMigration)=>{
      c.calls++;
      const result=structuredClone(c.result),receipt={type:'authority',reason:importing?'migration':'configuration',requestId:'owned-source-write',method,
        paramsHash:await nativeConfigurationWriteHash(params),resultHash:await nativeConfigurationWriteHash(result),
        beforeConfiguration:connection.identity.configuration,identity:{...connection.identity,configuration:c.nextConfiguration??'c'.repeat(64)},
        ...(importing?{privateValues:c.privateValues??[]}: {})};
      await c.beforeAdopt?.(receipt,result);await (importing?adoptMigration:adoptConfiguration)(receipt,result);return result;
    };
    return await run(c);
  } finally {v?.session.lock();await f.close();}
}

Then('the private vault adopts a verified broker receipt and retains no-op and stale-reference boundaries',{timeout:60000},async()=>{
  await context(async c=>{
    const original=structuredClone(c.reference),result=await c.execute();
    assert.deepEqual(result.response.result,c.result);assert.equal(c.reference.revision,original.revision+1);
    assert.equal(c.callbacks.length,1);assert.equal((await c.v.session.nativeConnections())[0].identity.configuration,'c'.repeat(64));
    const current=structuredClone(c.reference);await c.execute();assert.deepEqual(c.reference,current);
    assert.equal(c.callbacks.length,2);assert.equal(c.calls,2);
    await assert.rejects(c.execute(original),error=>error.code==='CONFLICT');assert.equal(c.calls,2);
    assert.equal(JSON.stringify(c.v.storage.state).includes(c.input.value),false);
  });
});

Then('missing duplicate or altered configuration receipts close their owned request without adoption',{timeout:60000},async()=>{
  for(const mode of ['missing','duplicate','method','request','input','result','configuration','identity']){
    const edit=frame=>{
      if(frame.type!=='authority'||frame.reason!=='configuration')return [frame];
      if(mode==='missing')return [];
      if(mode==='duplicate')return [frame,structuredClone(frame)];
      const changed=structuredClone(frame);
      if(mode==='method')changed.method='config/batchWrite';
      if(mode==='request')changed.requestId='foreign_request';
      if(mode==='input')changed.paramsHash='f'.repeat(64);
      if(mode==='result')changed.resultHash='f'.repeat(64);
      if(mode==='configuration')changed.beforeConfiguration='f'.repeat(64);
      if(mode==='identity')changed.identity.workspace='f'.repeat(64);
      return [changed];
    };
    await context(async c=>{
      const original=structuredClone(c.reference);await assert.rejects(c.execute(),undefined,mode);
      assert.deepEqual(c.reference,original);assert.equal(c.callbacks.length,0);
      assert.equal(c.f.frames.filter(frame=>frame.method==='config/value/write').length,1);
      assert.equal((await c.v.session.nativeConnections())[0].revision,original.revision);
      await waitForWatch(()=>c.f.starts===c.f.stops,'An invalid receipt left its controlled child open.');
    },'config/value/write',true,edit);
  }
});

Then('the paired migration broker binds completion and encrypted private values to the exact receipt',{timeout:60000},async()=>{
  await context(async c=>{
    const secret='OWNED_PAIRED_MIGRATION_VALUE_39721';c.privateValues=[secret];
    const original=structuredClone(c.reference),result=await c.execute();
    assert.deepEqual(result.response.result,c.result);assert.equal(c.reference.revision,original.revision+1);
    assert.equal(c.callbacks.length,1);assert.equal(c.f.finishedImports,1);
    assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(c.v.storage.state).includes(secret),false);
    const owner=()=>c.v.session.records().then(rows=>rows.find(row=>row.id===c.v.keyId));
    assert.deepEqual((await owner()).nativePrivateValues[c.reference.id],[secret]);
    const current=structuredClone(c.reference);c.result.importId=crypto.randomUUID();await c.execute();
    assert.deepEqual(c.reference,current);assert.deepEqual((await owner()).nativePrivateValues[current.id],[secret]);
    assert.equal(c.f.finishedImports,2);assert.equal(c.f.frames.filter(frame=>frame.method==='externalAgentConfig/import').length,2);
  },'externalAgentConfig/import',true);
});

Then('missing duplicate or altered migration receipts close their owner without importing public credentials',{timeout:60000},async()=>{
  for(const mode of ['missing','duplicate','request','input','result','effect','configuration','identity','privateValues']){
    const edit=frame=>{
      if(frame.type!=='authority'||frame.reason!=='migration')return [frame];
      if(mode==='missing')return [];
      if(mode==='duplicate')return [frame,structuredClone(frame)];
      const changed=structuredClone(frame);
      if(mode==='request')changed.requestId='foreign_import';
      if(mode==='input')changed.paramsHash='f'.repeat(64);
      if(mode==='result')changed.resultHash='f'.repeat(64);
      if(mode==='effect')changed.effectHash='invalid';
      if(mode==='configuration')changed.beforeConfiguration='f'.repeat(64);
      if(mode==='identity')changed.identity.runtimeId=crypto.randomUUID();
      if(mode==='privateValues')changed.privateValues={unowned:'credential'};
      return [changed];
    };
    await context(async c=>{
      c.privateValues=['OWNED_REJECTED_MIGRATION_VALUE_39721'];const original=structuredClone(c.reference);
      await assert.rejects(c.execute(),undefined,mode);assert.deepEqual(c.reference,original);assert.equal(c.callbacks.length,0);
      assert.equal(c.f.frames.filter(frame=>frame.method==='externalAgentConfig/import').length,1);
      const owner=(await c.v.session.records()).find(row=>row.id===c.v.keyId);assert.equal(owner.nativePrivateValues,undefined);
      await waitForWatch(()=>c.f.starts===c.f.stops,'A rejected migration receipt left its controlled child open.');
    },'externalAgentConfig/import',true,edit);
  }
});

Then('the paired configuration broker adopts only its owned verified receipt before publishing the result',{timeout:60000},async()=>{
  await context(async c=>{
    const original=structuredClone(c.reference),result=await c.execute();
    assert.deepEqual(result.response.result,c.result);assert.equal(c.reference.revision,original.revision+1);
    assert.equal(c.f.identity.configuration,'c'.repeat(64));assert.equal(c.callbacks.length,1);
    const current=structuredClone(c.reference);await c.execute();assert.deepEqual(c.reference,current);
    assert.equal(c.callbacks.length,2);assert.equal(c.f.frames.filter(frame=>frame.method==='config/value/write').length,2);
    const broker=c.v.session.nativeAgent,guard=async()=>{};
    await assert.rejects(broker.execute(c.connection,c.f.key,'d'.repeat(64),'config/value/write',c.input,guard),error=>error.code==='PERMISSION');
    await assert.rejects(broker.execute(c.connection,c.f.key,'d'.repeat(64),'externalAgentConfig/import',{migrationItems:[]},guard),error=>error.code==='PERMISSION');
    assert.equal(c.f.frames.filter(frame=>frame.method==='config/value/write').length,2);
  },'config/value/write',true);
});

Then('the private vault rejects foreign receipts and credential-bearing configuration results',{timeout:60000},async()=>{
  const variants=[['reason',r=>r.reason='migration'],['method',r=>r.method='config/batchWrite'],
    ['configuration',r=>r.beforeConfiguration='f'.repeat(64)],['runtime',r=>r.identity.runtimeId=crypto.randomUUID()]];
  for(const [name,mutate]of variants)await context(async c=>{
    const original=structuredClone(c.reference);c.beforeAdopt=mutate;
    await assert.rejects(c.execute(),error=>error.code==='AUTHORIZATION',name);
    assert.deepEqual(c.reference,original);assert.equal(c.callbacks.length,0);assert.equal(c.calls,1);
    assert.equal((await c.v.session.nativeConnections())[0].revision,original.revision);
  });
  for(const encoded of [false,true])await context(async c=>{
    c.result.version=encoded?Buffer.from(c.f.key).toString('base64'):c.f.key;
    await assert.rejects(c.execute(),error=>error.code==='REDACTED');assert.equal(c.callbacks.length,0);
    assert.equal((await c.v.session.nativeConnections())[0].revision,c.reference.revision);
  });
});

Then('the private vault rejects cancelled revoked and replaced receipt owners without publication',{timeout:60000},async()=>{
  for(const mode of ['cancel','revoke','remove','revision','storage'])await context(async c=>{
    const controller=new AbortController();let changed=false;
    c.beforeAdopt=async()=>{
      if(mode==='cancel')controller.abort();
      if(mode==='revoke')c.v.enabled=false;
      if(mode==='remove')await c.v.session.disconnectNativeRuntime(c.reference,true);
      if(mode==='revision')await c.v.session.enableNativeWorkflow(c.reference,c.selections);
      if(mode==='storage'){
        const records=c.v.session.records.bind(c.v.session);let pending=true;
        c.v.session.records=async()=>{const result=await records();if(pending){pending=false;await c.v.session.put(null,{label:'Concurrent record',kind:'secret',value:'OWNED_CONCURRENT_RECORD_25419'});changed=true;}return result;};
      }
    };
    await assert.rejects(c.execute(c.reference,controller.signal),error=>error.code===({cancel:'CANCELLED',revoke:'PERMISSION'}[mode]??'CONFLICT'),mode);
    assert.equal(c.callbacks.length,0);assert.equal(c.calls,1);
    if(mode==='storage'){assert.equal(changed,true);assert.ok((await c.v.session.records()).some(r=>r.label==='Concurrent record'));}
  });
});

Then('imported private values are adopted once retained across relock and removed with their owner',{timeout:60000},async()=>{
  await context(async c=>{
    const privateValue='OWNED_IMPORTED_PRIVATE_VALUE_43591';c.privateValues=[privateValue];
    const original=structuredClone(c.reference),result=await c.execute();assert.equal(c.reference.revision,original.revision+1);
    assert.equal(JSON.stringify(result).includes(privateValue),false);
    const owner=()=>c.v.session.records().then(records=>records.find(r=>r.id===c.v.keyId));
    assert.deepEqual((await owner()).nativePrivateValues[c.reference.id],[privateValue]);
    const current=structuredClone(c.reference);await c.execute();assert.deepEqual(c.reference,current);
    c.v.session.lock();c.v.session=c.v.newSession();await c.v.session.unlock(c.v.proof);
    assert.deepEqual((await owner()).nativePrivateValues[c.reference.id],[privateValue]);
    await c.v.session.disconnectNativeRuntime(c.reference,true);
    assert.equal((await owner()).nativePrivateValues,undefined);assert.deepEqual(await c.v.session.nativeConnections(),[]);
  },'externalAgentConfig/import');
});

async function selectedNative(c,method,foreign=false){
  const existing=c.selections.find(selection=>selection.operation.rpc.method===method);
  const document=structuredClone(existing?.document??scopeNativeRpcSchema(await readServiceSchema('codex'),method));
  if(foreign)document.info.title=(document.info.title??'Codex')+' separately approved';
  return {document,operation:nativeRpcOperation(document,'codex:'+method)};
}

Then('private vault native controls require their exact selected capability and preserve specialized dispatch',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,wrong=c.selection;
    await assert.rejects(api.cancelNativeAccountLogin(c.reference,c.selections,wrong,{}),{code:'PERMISSION'});
    await assert.rejects(api.cancelNativeGatewayLogin(c.reference,c.selections,wrong,{}),{code:'PERMISSION'});
    await assert.rejects(api.controlNativeTurn(c.reference,c.selections,wrong,{}),{code:'PERMISSION'});
    for(const [method,execute]of [
      ['account/login/cancel',selection=>api.cancelNativeAccountLogin(c.reference,c.selections,selection,{})],
      ['account/gatewayOAuth/cancel',selection=>api.cancelNativeGatewayLogin(c.reference,c.selections,selection,{})]
    ])await assert.rejects(execute(await selectedNative(c,method,true)),{code:'PERMISSION'});
    c.connection=await api.enableNativeWorkflow(c.reference,c.selections);c.reference=nativeReference(c.connection);
    await assert.rejects(api.loginNativeRuntime(c.reference,c.selections,{type:'chatgpt'}),{code:'PERMISSION'});
    const turn=await selectedNative(c,'turn/interrupt'),turnInput={threadId:crypto.randomUUID(),turnId:crypto.randomUUID()};
    await assert.rejects(api.controlNativeTurn(c.reference,c.selections,await selectedNative(c,'turn/interrupt',true),turnInput),{code:'PERMISSION'});
    let turnCalls=0;api.nativeAgent.control=async()=>{turnCalls++;return {};};
    assert.deepEqual((await api.executeNativeRuntime(c.reference,c.selections,turn,turnInput)).response.result,{});assert.equal(turnCalls,1);
    const cancel=await selectedNative(c,'account/login/cancel');api.nativeAccountAuth.cancelLogin=async()=>({status:'canceled'});
    assert.deepEqual((await api.executeNativeRuntime(c.reference,c.selections,cancel,{})).response.result,{status:'canceled'});
    const gateway=await selectedNative(c,'account/gatewayOAuth/cancel');api.nativeGatewayOAuth.cancel=async()=>({});
    assert.deepEqual((await api.executeNativeRuntime(c.reference,c.selections,gateway,{})).response.result,{});
    api.nativeGatewayOAuth.cancel=async()=>{throw new VaultError('NATIVE_UNKNOWN');};
    await assert.rejects(api.cancelNativeGatewayLogin(c.reference,c.selections,gateway,{}),{code:'NATIVE_UNKNOWN'});
    await assert.rejects(api.controlNativeCommand(c.reference,c.v.selection,[], 'command/foreign',{}),{code:'PERMISSION'});
    await assert.rejects(api.replyNativeCommand('invalid',crypto.randomUUID(),'accept'),{code:'INVALID'});
  });
});

Then('private vault authentication results cannot replace pinned runtime identity or borrow their pairing key',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,login=await selectedNative(c,'account/login/start');
    for(const credentialId of [c.v.keyId,crypto.randomUUID()])
      await assert.rejects(api.executeNativeRuntime(c.reference,c.selections,login,{type:'apiKey',credentialId}),{code:'PERMISSION'});
    api.nativeAccountAuth.login=async()=>({identity:{...c.connection.identity,workspace:'f'.repeat(64)},accountType:'none',requiresOpenaiAuth:false,account:{account:null,requiresOpenaiAuth:false}});
    await assert.rejects(api.executeNativeRuntime(c.reference,c.selections,login,{type:'chatgpt'}),{code:'AUTHORIZATION'});
    api.nativeGatewayOAuth.login=async()=>({identity:{...c.connection.identity,configuration:'f'.repeat(64)},response:{}});
    await assert.rejects(api.executeNativeRuntime(c.reference,c.selections,await selectedNative(c,'account/gatewayOAuth/login'),{}),{code:'AUTHORIZATION'});
    const controller=new AbortController();api.nativeActions.execute=async()=>{controller.abort();return {outcome:'reset'};};
    await assert.rejects(api.executeNativeRuntime(c.reference,c.selections,await selectedNative(c,'account/rateLimitResetCredit/consume'),{idempotencyKey:'owned'},controller.signal),{code:'CANCELLED'});
    api.nativeRuntime.readAccount=async()=>({account:{type:'apiKey'},requiresOpenaiAuth:true});
    await assert.rejects(api.executeNativeAccount(c.reference,c.v.selection,{refreshToken:false}),{code:'AUTHORIZATION'});
  });
});

Then('private vault native reads retain cancellation around schema guards and withhold malformed byte results',{timeout:60000},async()=>{
  for(const kind of ['account','initialize','query'])for(const phase of ['before','schema'])await context(async c=>{
    const controller=new AbortController(),api=c.v.session;let inBroker=false;
    c.v.onSchema=async()=>{if(inBroker&&phase==='schema')controller.abort();};
    const invoke=async guard=>{inBroker=true;if(phase==='before')controller.abort();await guard();assert.fail('A cancelled guard reached native dispatch.');};
    if(kind==='account'){
      api.nativeRuntime.readAccount=async(_id,_host,_key,_fingerprint,_identity,guard)=>invoke(guard);
      await assert.rejects(api.executeNativeAccount(c.reference,c.v.selection,{refreshToken:false},controller.signal),{code:'CANCELLED'});
    }else if(kind==='initialize'){
      api.nativeRuntime.initialize=async(_id,_host,_key,_fingerprint,_identity,_params,guard)=>invoke(guard);
      await assert.rejects(api.executeNativeInitialize(c.reference,c.v.selection,await selectedNative(c,'initialize'),nativeInitializeParams(),controller.signal),{code:'CANCELLED'});
    }else{
      api.nativeRuntime.query=async(_id,_host,_key,_fingerprint,_identity,_method,_params,guard)=>invoke(guard);
      await assert.rejects(api.executeNativeQuery(c.reference,c.v.selection,await selectedNative(c,'fs/readFile'),{path:'.'},controller.signal),{code:'CANCELLED'});
    }
  });
  await context(async c=>{
    c.v.session.nativeRuntime.query=async()=>({dataBase64:'%%%'});
    await assert.rejects(c.v.session.executeNativeQuery(c.reference,c.v.selection,await selectedNative(c,'fs/readFile'),{path:'.'}),{code:'NATIVE_CONTRACT'});
  });
});

Then('private standalone MCP sign-in retains selection ownership and sanitizes its final result',{timeout:60000},async()=>{
  for(const mode of ['selection','stale','guard','result','late-cancel'])await context(async c=>{
    const api=c.v.session,selection=await selectedNative(c,'mcpServer/oauth/login'),controller=new AbortController();let inBroker=false;
    api.nativeRuntime.mcpOAuth=async(_id,_host,_key,_fingerprint,_identity,_params,guard)=>{
      inBroker=true;
      if(mode==='guard'){controller.abort();await guard();}
      return {name:'owned',success:true,loginId:mode==='result'?c.f.key:'owned',threadId:null,error:null};
    };
    c.v.onSchema=async()=>{if(inBroker&&mode==='late-cancel')controller.abort();};
    await assert.rejects(api.executeNativeMcpOAuth(mode==='stale'?{...c.reference,revision:c.reference.revision+1}:c.reference,c.v.selection,mode==='selection'?c.selection:selection,{name:'owned'},[],controller.signal),
      {code:{selection:'PERMISSION',stale:'CONFLICT',guard:'CANCELLED',result:'REDACTED','late-cancel':'CANCELLED'}[mode]});
  });
});

Then('private native entrypoints reject changed key model and configuration authority',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,original=api.records.bind(api),frameCount=c.f.frames.length;
    const initialize=await selectedNative(c,'initialize'),query=await selectedNative(c,'fs/readFile'),mcp=await selectedNative(c,'mcpServer/oauth/login');
    const watches=await Promise.all(['fs/watch','fs/unwatch'].map(method=>selectedNative(c,method)));
    const commands=await Promise.all(['command/exec','command/exec/write','command/exec/resize','command/exec/terminate'].map(method=>selectedNative(c,method)));
    const entrypoints=[
      ()=>api.executeNativeAccount(c.reference,c.v.selection,{refreshToken:false}),
      ()=>api.executeNativeInitialize(c.reference,c.v.selection,initialize,nativeInitializeParams()),
      ()=>api.executeNativeMcpOAuth(c.reference,c.v.selection,mcp,{name:'owned'}),
      ()=>api.executeNativeQuery(c.reference,c.v.selection,query,{path:'.'}),
      ()=>api.executeNativeWatch(c.reference,c.v.selection,watches,{watchId:'owned',path:'.'}),
      ()=>api.executeNativeCommand(c.reference,c.v.selection,commands,{command:['owned']})
    ];
    try{
      for(const mode of ['key','model','configuration']){
        api.records=async()=>{
          const records=await original(),owner=records.find(record=>record.id===c.v.keyId),connection=owner.nativeConnections[0];
          if(mode==='key')owner.value='CHANGED_OWNED_PAIRING_VALUE_69541';
          if(mode==='model')connection.modelFingerprint='f'.repeat(64);
          if(mode==='configuration')connection.label+=' changed outside its fingerprint';
          return records;
        };
        for(const execute of entrypoints)await assert.rejects(execute(),{code:'AUTHORIZATION'},mode);
      }
    }finally{api.records=original;}
    assert.equal(c.f.frames.length,frameCount);
  });
});

Then('private watch and command authority retain their exact state across asynchronous guards',{timeout:60000},async()=>{
  for(const kind of ['watch','command'])for(const phase of ['records','current','schema'])await context(async c=>{
    const api=c.v.session,methods=kind==='watch'?['fs/watch','fs/unwatch']:['command/exec','command/exec/write','command/exec/resize','command/exec/terminate'];
    const selections=await Promise.all(methods.map(method=>selectedNative(c,method)));
    const records=api.records.bind(api),current=api.assertCurrent.bind(api);let armed=false,changed=false;
    const replace=()=>{if(!changed){changed=true;api.state={...api.state};}};
    api.records=async()=>{const result=await records();armed=true;if(phase==='records')replace();return result;};
    api.assertCurrent=async()=>{await current();if(armed&&phase==='current')replace();};
    c.v.onSchema=async()=>{if(armed&&phase==='schema')replace();};
    const execute=kind==='watch'?()=>api.executeNativeWatch(c.reference,c.v.selection,selections,{watchId:'owned',path:'.'}):()=>api.executeNativeCommand(c.reference,c.v.selection,selections,{command:['owned']});
    await assert.rejects(execute(),{code:'CONFLICT'},kind+' '+phase);assert.equal(changed,true);
  });
});

Then('private unwatch failures retain secret filtering cancellation and sibling ownership',{timeout:60000},async()=>{
  for(const mode of ['secret','error','cancel','late-cancel','plain-error'])await context(async c=>{
    const api=c.v.session,selections=await Promise.all(['fs/watch','fs/unwatch'].map(method=>selectedNative(c,method))),controller=new AbortController();
    let dispatched=false,closed=0;const close=api.closeNativeFailure.bind(api);
    api.closeNativeFailure=(...args)=>{closed++;return close(...args);};
    api.nativeWatches.unwatch=async()=>{
      dispatched=true;
      if(mode==='error')throw new VaultError('NATIVE_FILESYSTEM');
      if(mode==='plain-error')throw new Error('Controlled private watch failure.');
      if(mode==='cancel'){controller.abort();throw new VaultError('CANCELLED');}
      return {};
    };
    c.v.onSchema=async()=>{if(dispatched&&mode==='late-cancel')controller.abort();};
    const expected=mode==='secret'?'REDACTED':mode==='error'?'NATIVE_FILESYSTEM':mode==='plain-error'?undefined:'CANCELLED';
    await assert.rejects(api.executeNativeUnwatch(c.reference,c.v.selection,selections,{watchId:mode==='secret'?c.f.key:'owned'},controller.signal),expected?{code:expected}:{message:'Controlled private watch failure.'});
    assert.equal(dispatched,mode!=='secret');assert.equal(closed,mode==='cancel'||mode==='late-cancel'?0:1);
  });
});

Then('native result byte inspection preserves UTF-8 boundaries callback errors and the nesting limit',()=>{
  const values=[];reviewNativeValueStrings({first:'hello',nested:[null,42,true,{unicode:'å🤖'}],empty:{}},bytes=>values.push([...bytes]));
  assert.deepEqual(values.map(bytes=>new TextDecoder().decode(Uint8Array.from(bytes))),['hello','å🤖']);
  let exact='bounded';for(let i=0;i<32;i++)exact=[exact];
  const visited=[];reviewNativeValueStrings(exact,bytes=>visited.push(new TextDecoder().decode(bytes)));assert.deepEqual(visited,['bounded']);
  assert.throws(()=>reviewNativeValueStrings([exact],()=>assert.fail('An overdeep result reached byte inspection.')),{code:'LIMIT'});
  const failure=new Error('Controlled native byte review failure.');assert.throws(()=>reviewNativeValueStrings('owned',()=>{throw failure;}),error=>error===failure);
});

Then('private migration updates retain sibling connections and private values across credential edits',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,check=api.nativeRuntime.check.bind(api.nativeRuntime);
    let sibling;
    try{
      api.nativeRuntime.check=async()=>({identity:structuredClone(c.connection.identity),accountType:c.connection.accountType,requiresOpenaiAuth:c.connection.requiresOpenaiAuth});
      sibling=await api.pairNativeRuntime({...c.v.input,label:'Independent sibling'},c.v.selection);
    }finally{api.nativeRuntime.check=check;}
    c.privateValues=['OWNED_IMPORTED_VALUE_95271'];await c.execute();
    const before=await api.records(),owner=before.find(record=>record.id===c.v.keyId);
    assert.deepEqual(owner.nativePrivateValues[c.reference.id],c.privateValues);
    assert.deepEqual(owner.nativeConnections.find(connection=>connection.id===sibling.id),Object.fromEntries(Object.entries(sibling).filter(([key])=>key!=='connected')));
    await api.put(null,{id:owner.id,label:'Retained private pairing',kind:owner.kind,value:owner.value});
    const retained=(await api.records()).find(record=>record.id===owner.id);
    assert.deepEqual(retained.nativePrivateValues,owner.nativePrivateValues);
    assert.deepEqual(retained.nativeConnections,owner.nativeConnections);
  },'externalAgentConfig/import');
});

Then('empty private native inventories remain valid without unrelated connection authority',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,records=await api.records(),owner=records.find(record=>record.id===c.v.keyId);
    delete owner.nativeConnections;owner.nativePrivateValues={};
    await api.save(records);
    const retained=(await api.records()).find(record=>record.id===owner.id);
    assert.deepEqual(retained.nativePrivateValues,{});assert.equal(retained.nativeConnections,undefined);
    owner.nativePrivateValues={[crypto.randomUUID()]:['OWNED_UNBOUND_PRIVATE_VALUE_69541']};
    await assert.rejects(api.save(records),{code:'INVALID'});
    assert.deepEqual((await api.records()).find(record=>record.id===owner.id).nativePrivateValues,{});
  });
});

Then('native controls preserve ordinary input errors and signal-owned cancellation',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,commands=await Promise.all(['command/exec','command/exec/write','command/exec/resize','command/exec/terminate'].map(method=>selectedNative(c,method)));
    const watches=await Promise.all(['fs/watch','fs/unwatch'].map(method=>selectedNative(c,method)));
    await assert.rejects(api.executeNativeWatch({...c.reference,revision:c.reference.revision+1},c.v.selection,watches,{watchId:'owned',path:'.'}),{code:'CONFLICT'});
    let closed=0;const close=api.closeNativeFailure.bind(api);api.closeNativeFailure=(...args)=>{closed++;return close(...args);};
    const controller=new AbortController();
    api.nativeCommands.control=async()=>{controller.abort();throw new VaultError('CANCELLED');};
    await assert.rejects(api.controlNativeCommand(c.reference,c.v.selection,commands,'command/exec/terminate',{processId:'owned'},controller.signal),{code:'CANCELLED'});assert.equal(closed,0);
    await assert.rejects(api.controlNativeCommand(c.reference,c.v.selection,commands,'command/exec/resize',{processId:'owned',size:{cols:0,rows:1}}),error=>error.field==='size');assert.equal(closed,0);
  });
});

Then('all configuration mutation families reject receipts for foreign configuration authority',{timeout:60000},async()=>{
  for(const [method,params]of [['marketplace/add',{source:'owner/repository'}],['plugin/reconcile',{}],['plugin/share/save',{pluginPath:'.'}]])await context(async c=>{
    c.input=params;c.beforeAdopt=receipt=>{receipt.beforeConfiguration='f'.repeat(64);};
    await assert.rejects(c.execute(),{code:'AUTHORIZATION'},method);assert.equal(c.calls,1);assert.equal(c.callbacks.length,0);
    assert.equal((await c.v.session.nativeConnections())[0].revision,c.reference.revision);
  },method);
});

Then('native sign-in adoption updates only its selected connection and retains sibling private values',{timeout:60000},async()=>{
  await context(async c=>{
    const api=c.v.session,check=api.nativeRuntime.check.bind(api.nativeRuntime);let sibling;
    try{
      api.nativeRuntime.check=async()=>({identity:structuredClone(c.connection.identity),accountType:c.connection.accountType,requiresOpenaiAuth:c.connection.requiresOpenaiAuth});
      sibling=await api.pairNativeRuntime({...c.v.input,label:'Independent account sibling'},c.v.selection);
    }finally{api.nativeRuntime.check=check;}
    api.nativeGatewayOAuth.login=async()=>({identity:structuredClone(c.connection.identity),response:{}});
    api.nativeAccountAuth.logout=async()=>({identity:structuredClone(c.connection.identity),accountType:c.connection.accountType,requiresOpenaiAuth:c.connection.requiresOpenaiAuth});
    for(const method of ['account/gatewayOAuth/login','account/logout']){
      const selection=await selectedNative(c,method),before=c.reference.revision;
      await api.executeNativeRuntime(c.reference,c.selections,selection,{},undefined,undefined,reference=>{c.reference=reference;});
      assert.equal(c.reference.revision,before+1);
      const connections=await api.nativeConnections();assert.equal(connections.length,2);
      assert.equal(connections.find(connection=>connection.id===sibling.id).revision,sibling.revision);
    }
    const records=await api.records(),owner=records.find(record=>record.id===c.v.keyId),privateValue='OWNED_SIBLING_PRIVATE_VALUE_69541';
    owner.nativePrivateValues={[sibling.id]:[privateValue]};await api.save(records);
    await api.disconnectNativeRuntime(c.reference,true);
    const retained=(await api.records()).find(record=>record.id===owner.id);
    assert.deepEqual(retained.nativePrivateValues,{[sibling.id]:[privateValue]});
    assert.deepEqual(retained.nativeConnections.map(connection=>connection.id),[sibling.id]);
    const previous=api.state;
    await api.put(null,{label:'Concurrent safe credential',kind:'secret',value:'OWNED_CONCURRENT_VALUE_69541'});
    const current=structuredClone(c.v.storage.state);
    await assert.rejects(api.save(await api.records(),undefined,undefined,undefined,undefined,previous),{code:'CONFLICT'});
    assert.deepEqual(c.v.storage.state,current);
  });
});
