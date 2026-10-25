// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { jiraHostFixture, jiraCanaries, jiraSites, jiraAccountId } from '../tests/jira-companion.fixture.mjs';
import { createJiraCompanion } from '../companions/jira/host.mjs';
import { openJiraStore } from '../companions/jira/store.mjs';
import { runJiraCompanion } from '../companions/jira/server.mjs';
import { readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { jiraOAuthAlternative, validateJiraMetadata, jiraHost } from './lib/secrets/jira-config.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { httpConnectionReference } from './lib/secrets/http-connections.ts';

const applicationOrigin = 'https://operations.test';
const ordinary = () => ({ id:'jira:getCurrentUser',name:'Get current user',description:'',group:'Myself',method:'GET',path:'/rest/api/3/myself',
  fields:[{key:'query:expand',name:'expand',label:'expand',description:'',location:'query',type:'string',required:false}],bodyRequired:false,responseMediaType:'application/json',
  security:[[{name:'basicAuth',kind:'basic',header:'Authorization'}],[{name:'OAuth2',kind:'bearer',header:'Authorization'}]],
  oauthScopes:[{basicAuth:[]},{OAuth2:['read:jira-user']}] });
const denied = error => error instanceof Error;
const sensitive = f => [jiraCanaries.clientSecret,jiraCanaries.accessKey,jiraCanaries.code,f.host.accessToken,f.host.refreshToken,f.host.selected?.capability].filter(Boolean);
const safe = (value, secrets) => { for(const secret of secrets)for(const encoded of [secret,encodeURIComponent(secret),new URLSearchParams({v:secret}).toString().slice(2)])assert.ok(!JSON.stringify(value).includes(encoded),'private material crossed the inspected boundary'); };
async function fixture(options = {}) {
  const host=await jiraHostFixture({...options,applicationOrigin});
  const key=await newVaultKey(),id=randomUUID(),methodId=randomUUID(),recovery=randomBase64(128),salt=randomBase64(16);
  const envelope={id:methodId,kind:'recovery',revision:1,salt,wrappedKey:await wrapVaultKey(key,await recoveryKey(recovery,salt),{vaultId:id,epoch:1,kind:'recovery',id:methodId,revision:1})};
  const storage={state:{revision:1,lockEpoch:1,snapshot:await sealSnapshot({id,epoch:1,revision:1,envelopes:[envelope],records:[]},key)},
    async read(){return structuredClone(this.state);},async replace(expected,snapshot,keys){if(expected.revision!==this.state.revision||expected.lockEpoch!==this.state.lockEpoch)throw new VaultError('CONFLICT');this.state={revision:this.state.revision+1,lockEpoch:this.state.lockEpoch+1,snapshot:structuredClone(snapshot),keys:structuredClone(keys)};return this.read();},
    async indexKeys(expected,keys){assert.equal(expected.revision,this.state.revision);this.state.keys=structuredClone(keys);return this.read();},async lock(){this.state.revision++;this.state.lockEpoch++;return this.read();}};
  const f={host,storage,proof:{methodId,secret:recovery},enabled:true,operation:ordinary()};
  const runtime={applicationOrigin:()=>applicationOrigin,now:host.now,fetchRequest:(...args)=>host.clientFetch(...args)};
  f.newSession=()=>new VaultSession(storage,undefined,async()=>{if(!f.enabled)throw new VaultError('PERMISSION');},{},runtime);
  f.session=f.newSession();await f.session.unlock(f.proof);
  const entries=await f.session.put(null,{label:'Jira companion access key',kind:'secret',value:jiraCanaries.accessKey});f.keyId=entries.find(item=>item.label==='Jira companion access key').id;
  f.approved=await approvedOperation(f.operation,jiraSites[0].url);
  f.input={host:host.config.publicOrigin,accessKeyId:f.keyId,label:'Jira fixture'};
  f.begin=(replace,session=f.session)=>session.beginJiraOAuth(f.input,f.approved,replace);
  f.connect=async(replace,session=f.session)=>{
    const task=await f.begin(replace,session);assert.equal((await session.pollJiraOAuth(task.id)).phase,'waiting');await host.callback(task);
    const selected=await session.pollJiraOAuth(task.id);assert.equal(selected.phase,'choose-site');assert.equal(selected.sites.length,2);
    f.connection=await session.completeJiraOAuth(task.id,jiraSites[0].id);f.binding=await session.connectionBinding(httpConnectionReference(f.connection),f.approved);return f.connection;
  };
  f.run=(values={},session=f.session,binding=f.binding,descriptor=f.approved,signal)=>session.execute(descriptor,values,binding,signal);
  f.close=()=>host.close();return f;
}
Then('the pinned Jira current user operation qualifies only its reviewed companion route',async()=>{
  const document=await readServiceSchemaUpstream('jira');assert.equal(createHash('sha256').update(JSON.stringify(document)).digest('hex'),'ae048ce3f43809abb18e96523e22c8adb67b6f720bfc4bf4c59594822c3cb325');
  const source=structuredClone(document);source.servers=[{url:jiraSites[0].url}];const models=inspectServiceSchema(source,'jira').operations;assert.equal(models.length,630);
  const current=models.find(item=>item.id==='jira:getCurrentUser');assert.ok(!current.unavailableReason);const descriptor=await approvedOperation(current,jiraSites[0].url);
  assert.equal(jiraOAuthAlternative(descriptor),1);assert.deepEqual(current.security.map(option=>option[0].kind),['basic','bearer']);
  for(const change of [{origin:'https://evil.test'},{origin:'https://your-domain.atlassian.net'},{operation:{...current,method:'POST'}},{operation:{...current,path:'/rest/api/3/user'}},
    {operation:{...current,fields:[...current.fields,{key:'query:url',name:'url',location:'query',type:'string'}]}}])assert.equal(jiraOAuthAlternative({...descriptor,...change}),undefined);
});
Then('Jira consent selects a discovered matching site and executes privately with opaque references',async()=>{
  const f=await fixture();try{
    const task=await f.begin();await f.host.callback(task);await f.session.pollJiraOAuth(task.id);
    await assert.rejects(f.session.completeJiraOAuth(task.id,jiraSites[1].id),denied);
    assert.equal((await f.session.connections()).length,0);
    await f.connect();const result=await f.run({'query:expand':'groups,applicationRoles'});assert.equal(result.response.body.accountId,jiraAccountId);
    assert.equal(f.connection.oauth.cloudId,jiraSites[0].id);assert.equal(f.connection.oauth.siteUrl,jiraSites[0].url);assert.deepEqual(f.binding.credentials,{});
    safe([result,await f.session.list(),await f.storage.read(),f.connection,f.binding],sensitive(f));
    const credential=Object.values(f.connection.credentials)[0];assert.match(await f.session.copyCredential(credential),/^[a-f0-9-]{36}$/i);
    assert.equal(f.host.providerCalls.filter(call=>call.address.includes('/oauth/token')&&!call.address.endsWith('accessible-resources')).length,2);
    for(const reply of f.host.hostReplies)safe(reply,[jiraCanaries.clientSecret,f.host.accessToken,f.host.refreshToken]);
  }finally{await f.close();}
});
Then('Jira companion origin key configuration and private claim checks prevent unauthorized forwarding',async()=>{
  const f=await fixture();try{
    const host=f.host,url=host.config.publicOrigin,auth={Origin:applicationOrigin,Authorization:'Bearer '+jiraCanaries.accessKey,'X-Operations-Companion':host.host.configuration.fingerprint};
    for(const headers of [{Origin:'https://evil.test',Authorization:auth.Authorization},{Origin:applicationOrigin},{...auth,Authorization:'Bearer wrong'}]){
      const response=await host.host.handle(new Request(url+'/v1/jira/config',{headers}));assert.equal(response.status,403);
      if(headers.Origin!==applicationOrigin)assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
    }
    const task=await f.begin();const bad=await host.host.handle(new Request(url+'/v1/jira/authorizations/'+task.id,{headers:{...auth,'X-Operations-Claim':'A'.repeat(43)}}));assert.equal(bad.status,403);
    const preflight=await host.host.handle(new Request(url+'/v1/jira/config',{method:'OPTIONS',headers:{Origin:applicationOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,x-operations-companion'}}));
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),applicationOrigin);assert.equal(preflight.headers.has('Access-Control-Allow-Credentials'),false);
    for(const requested of [{method:'PATCH',header:'authorization'},{method:'GET',header:'x-arbitrary-relay'}]){
      const denied=await host.host.handle(new Request(url+'/v1/jira/config',{method:'OPTIONS',headers:{Origin:applicationOrigin,'Access-Control-Request-Method':requested.method,'Access-Control-Request-Headers':requested.header}}));assert.equal(denied.status,403);
    }
    assert.equal(host.providerCalls.length,0);
    await f.session.cancelJiraOAuth(task.id);await f.connect();
    for(const [path,body] of [['/v1/jira/relay',{url:'https://evil.test'}],['/v1/jira/connections/'+host.selected.id+'/myself',{requestId:randomUUID(),url:'https://evil.test'}]]){
      const reply=await host.host.handle(new Request(url+path,{method:'POST',headers:{...auth,'Content-Type':'application/json','X-Operations-Connection':host.selected.capability},body:JSON.stringify(body)}));assert.ok([400,404].includes(reply.status));
    }
  }finally{await f.close();}
});
Then('Jira callback state denial replay expiry cancellation and lock cannot publish stale connections',async()=>{
  for(const mode of ['wrong-state','denied','duplicate','cancel','expired','lock']){
    const f=await fixture();try{
      const task=await f.begin();
      if(mode==='cancel')await f.session.cancelJiraOAuth(task.id);
      if(mode==='lock')f.session.lock();
      if(mode==='expired')f.host.advance(300001);
      await f.host.callback(task,{...(mode==='wrong-state'?{state:'A'.repeat(43)}:{}),...(mode==='denied'?{denied:true}:{}),...(mode==='duplicate'?{duplicate:true}:{})});
      if(mode==='wrong-state'){assert.equal(f.host.providerCalls.length,0);await f.session.cancelJiraOAuth(task.id);}
      else await assert.rejects(f.session.pollJiraOAuth(task.id),denied);
      if(mode!=='lock')assert.equal(f.host.providerCalls.length,0);
    }finally{await f.close();}
  }
  const f=await fixture();try{const task=await f.begin();await f.host.callback(task);const count=f.host.providerCalls.length;await f.host.callback(task);assert.equal(f.host.providerCalls.length,count);await f.session.cancelJiraOAuth(task.id);}finally{await f.close();}
});
Then('Jira host tokens and opaque vault capabilities persist encrypted across restart and reload',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'operations-jira-store-')),storageKey=randomBytes(32).toString('base64url'),hostId=randomUUID();
  const store=await openJiraStore(directory,storageKey,hostId),f=await fixture({store,hostId});
  try{
    await f.connect();const reference=httpConnectionReference(f.connection);const encrypted=await readFile(join(directory,'connections.aes-gcm.json'),'utf8');
    safe(encrypted,sensitive(f));assert.equal((await stat(join(directory,'connections.aes-gcm.json'))).mode&0o777,0o600);
    f.session.lock();await f.host.host.close();f.host.store=await openJiraStore(directory,storageKey,hostId);
    f.host.host=await createJiraCompanion(f.host.config,{store:f.host.store,fetchRequest:f.host.provider,now:f.host.now});
    const session=f.newSession();await session.unlock(f.proof);const binding=await session.connectionBinding(reference,f.approved);const result=await f.run({},session,binding);
    assert.equal(result.response.body.accountId,jiraAccountId);safe([await session.list(),await f.storage.read()],sensitive(f));
    await assert.rejects(openJiraStore(directory,randomBytes(32).toString('base64url'),hostId),/could not be opened/);
  }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
Then('Jira requests serialize rotating refresh and retain the selected site account and resource',async()=>{
  const f=await fixture();try{
    await f.connect();f.host.advance(3600001);const result=await Promise.all([f.run(),f.run({'query:expand':'groups'})]);
    assert.ok(result.every(item=>item.response.body.accountId===jiraAccountId));
    const tokenCalls=f.host.providerCalls.filter(call=>call.address==='https://auth.atlassian.com/oauth/token');assert.equal(tokenCalls.length,2);assert.equal(tokenCalls.filter(call=>JSON.parse(call.body).grant_type==='refresh_token').length,1);
    assert.equal(f.host.providerCalls.filter(call=>call.address.includes('/rest/api/3/myself')).length,3);
    const record=(await f.host.store.list())[0];assert.ok(!record.tokens.refreshPending);assert.equal(record.tokens.refreshToken,f.host.refreshToken);safe(result,sensitive(f));
  }finally{await f.close();}
});
Then('Jira unknown refresh outcomes remain blocked after restart without token or resource replay',async()=>{
  const f=await fixture();try{
    await f.connect();f.host.advance(3600001);f.host.failAfterRefresh=true;
    await assert.rejects(f.run(),denied);assert.equal((await f.host.store.list())[0].tokens.refreshPending,true);
    const count=f.host.providerCalls.length;await f.host.host.close();f.host.host=await createJiraCompanion(f.host.config,{store:f.host.store,fetchRequest:f.host.provider,now:f.host.now});
    await assert.rejects(f.run(),denied);assert.equal(f.host.providerCalls.length,count);
    const removed=await f.session.removeConnection(httpConnectionReference(f.connection));assert.equal(removed.remoteRemoved,true);
  }finally{await f.close();}
});
Then('Jira rejects missing refresh material broader scopes and unrelated discovered resources',async()=>{
  for(const mode of ['scope','refresh','sites','url']){
    const f=await fixture();try{
      if(mode==='scope')f.host.wrongScope=true;if(mode==='refresh')f.host.missingRefresh=true;
      if(mode==='sites')f.host.sites=[];if(mode==='url')f.host.sites=[{...jiraSites[0],url:'https://evil.test'}];
      const task=await f.begin();await f.host.callback(task);await assert.rejects(f.session.pollJiraOAuth(task.id),denied);
      assert.equal((await f.session.connections()).length,0);
      assert.equal(f.host.providerCalls.filter(call=>call.address.includes('/rest/api/3/myself')).length,0);
    }finally{await f.close();}
  }
});
Then('Jira rejects changed accounts sites companion registrations and selected access keys',async()=>{
  for(const mode of ['account','site','registration','key','schema']){
    const f=await fixture();try{
      await f.connect();const calls=f.host.hostRequests.length;
      if(mode==='account')f.host.accountId='different-account';
      if(mode==='site'){f.host.sites=[];f.host.advance(3600001);}
      if(mode==='registration'){await f.host.host.close();f.host.config.clientId='another-registration';f.host.host=await createJiraCompanion(f.host.config,{store:f.host.store,fetchRequest:f.host.provider,now:f.host.now});}
      if(mode==='key')await f.session.put(null,{id:f.keyId,label:'Jira companion access key',kind:'secret',value:'B'.repeat(43)});
      if(mode==='schema')f.enabled=false;
      await assert.rejects(f.run(),denied);if(['key','schema'].includes(mode))assert.equal(f.host.hostRequests.length,calls);
    }finally{await f.close();}
  }
});
Then('Jira disconnect revokes the host reference and reports unconfirmed remote cleanup honestly',async()=>{
  for(const offline of [false,true]){
    const f=await fixture();try{
      await f.connect();const reference=httpConnectionReference(f.connection);f.host.clientFailure=offline;
      const result=await f.session.removeConnection(reference);assert.equal(result.remoteRemoved,!offline);
      assert.equal((await f.session.connections()).length,0);assert.equal((await f.host.store.list()).length,offline?1:0);
      await assert.rejects(f.run(),denied);
    }finally{await f.close();}
  }
});
Then('Jira JSON status and errors are preserved while host and vault secrets are scrubbed without retries',async()=>{
  const f=await fixture();try{
    await f.connect();await f.session.put(null,{label:'unrelated private value',kind:'secret',value:'unrelated-vault-private-5729'});
    f.host.extraEcho=['unrelated-vault-private-5729'];f.host.echo=true;
    const result=await f.run();assert.equal(result.response.redacted,true);safe(result,[...sensitive(f),'unrelated-vault-private-5729']);
    f.host.resourceStatus=403;const before=f.host.providerCalls.length,error=await f.run().catch(error=>error);
    assert.equal(error.response.status,403);assert.equal(error.cause,undefined);safe({message:error.message,response:error.response},[...sensitive(f),'unrelated-vault-private-5729']);
    assert.equal(f.host.providerCalls.length,before+1);
  }finally{await f.close();}
});
Then('Jira reconnect replaces only the current grant and rejects an account switch',async()=>{
  const f=await fixture();try{
    await f.connect();const old=httpConnectionReference(f.connection),oldBinding=structuredClone(f.binding),oldCapability=structuredClone(f.host.selected);
    await f.connect(old);const next=httpConnectionReference(f.connection);assert.equal(next.id,old.id);assert.equal(next.revision,2);assert.notEqual(next.fingerprint,old.fingerprint);
    assert.equal((await f.host.store.list()).length,1);assert.notEqual(f.host.selected.id,oldCapability.id);
    const calls=f.host.hostRequests.length;await assert.rejects(f.run({},f.session,oldBinding),denied);assert.equal(f.host.hostRequests.length,calls);
    const response=await f.host.host.handle(new Request(f.input.host+'/v1/jira/connections/'+oldCapability.id+'/myself',{method:'POST',
      headers:{Origin:applicationOrigin,Authorization:'Bearer '+jiraCanaries.accessKey,'Content-Type':'application/json',
        'X-Operations-Companion':f.host.host.configuration.fingerprint,'X-Operations-Connection':oldCapability.capability},body:JSON.stringify({requestId:randomUUID()})}));
    assert.equal(response.status,401);
    f.host.accountId='another-account';const task=await f.begin(next);await f.host.callback(task);await f.session.pollJiraOAuth(task.id);
    await assert.rejects(f.session.completeJiraOAuth(task.id,jiraSites[0].id),denied);assert.equal((await f.host.store.list()).length,1);
    assert.deepEqual(httpConnectionReference((await f.session.connections())[0]),next);
  }finally{await f.close();}
});
Then('the Jira companion launcher reads private key files and serves its real HTTP boundary',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'operations-jira-launcher-')),port=24573,publicOrigin='http://127.0.0.1:'+port,allowedOrigin='http://127.0.0.1:17777';
  let running;try{
    const client=join(directory,'client-secret'),access=join(directory,'access-key'),storage=join(directory,'storage-key');
    await writeFile(client,jiraCanaries.clientSecret,{mode:0o600});await writeFile(access,jiraCanaries.accessKey,{mode:0o600});await writeFile(storage,randomBytes(32).toString('base64url'),{mode:0o600});
    running=await runJiraCompanion({OPERATIONS_JIRA_PUBLIC_ORIGIN:publicOrigin,OPERATIONS_JIRA_HOST_ID:randomUUID(),OPERATIONS_JIRA_CLIENT_ID:'launcher-client',
      OPERATIONS_JIRA_CLIENT_SECRET_FILE:client,OPERATIONS_JIRA_ACCESS_KEY_FILE:access,OPERATIONS_JIRA_STORAGE_KEY_FILE:storage,
      OPERATIONS_JIRA_DATA_DIRECTORY:join(directory,'data'),OPERATIONS_JIRA_ALLOWED_ORIGINS:JSON.stringify([allowedOrigin]),OPERATIONS_JIRA_PORT:String(port)});
    const response=await fetch(publicOrigin+'/v1/jira/config',{headers:{Origin:allowedOrigin,Authorization:'Bearer '+jiraCanaries.accessKey}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),allowedOrigin);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const config=await response.json();assert.equal(config.redirectUri,publicOrigin+'/oauth/jira/callback');safe(config,[jiraCanaries.clientSecret,jiraCanaries.accessKey]);
    const refused=await fetch(publicOrigin+'/v1/jira/config',{headers:{Origin:allowedOrigin}});assert.equal(refused.status,403);
    safe(await refused.json(),[jiraCanaries.clientSecret,jiraCanaries.accessKey]);
  }finally{await running?.close();await rm(directory,{recursive:true,force:true});}
});
Then('Jira unsupported routes forged metadata oversized responses and cancelled dispatch never broaden the companion',async()=>{
  const f=await fixture();try{
    await f.connect();const before=f.host.hostRequests.length;
    const controller=new AbortController();controller.abort();await assert.rejects(f.run({},f.session,f.binding,f.approved,controller.signal),denied);
    for(const values of [{'query:url':'https://evil.test'},{'header:Authorization':'override'},{'body:$':'ignored'}])await assert.rejects(f.run(values),denied);
    assert.equal(f.host.hostRequests.length,before);
    for(const host of ['http://evil.test','https://user:password@host.test','https://host.test/base','https://host.test/?redirect=evil','https://host.test/#evil'])assert.throws(()=>jiraHost(host,applicationOrigin));
    assert.throws(()=>validateJiraMetadata({...f.connection.oauth,cloudId:'not-a-cloud'}));assert.throws(()=>validateJiraMetadata({...f.connection.oauth,redirectUri:'https://evil.test'}));
    const fetch=f.host.clientFetch;f.host.clientFetch=async(address,init)=>address.endsWith('/config')?new Response(JSON.stringify({padding:'x'.repeat(65537)}),{headers:{'Content-Type':'application/json','X-Operations-Companion':f.host.host.configuration.fingerprint}}):fetch(address,init);
    await assert.rejects(f.begin(),error=>error.code==='LIMIT');
  }finally{await f.close();}
});
