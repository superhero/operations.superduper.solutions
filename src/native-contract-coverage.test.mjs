// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {pathToFileURL} from 'node:url';
import {guardianFixtureNotice} from '../tests/native-guardian.fixture.mjs';
import {NativeGuardianReviews,nativeGuardianEvent,nativeGuardianParams} from './lib/native-guardian.ts';
import {nativeGatewayOAuthUrl,nativeGatewayOAuthState} from './lib/native-gateway-oauth.ts';
import {nativeCommandParams,nativeCommandSize,nativeCommandBytes,nativeCommandOutput,
  nativeCommandOutputMethod,nativeCommandLimits,isNativeCommandValue} from './lib/native-command.ts';
import {isNativeQueryMethod,nativeRuntimeProfile,nativeRuntimeVersion} from './lib/native-runtime-contract.ts';
import {nativeBoundedThreadParams} from './lib/native-stored-thread.ts';
import * as accountActions from './lib/native-account-actions.ts';
import * as accountAuth from './lib/native-account-auth.ts';
import * as accountRead from './lib/native-account-read.ts';
import * as account from './lib/native-account.ts';
import * as configurationRead from './lib/native-configuration-read.ts';
import * as configurationControl from './lib/native-configuration-control.ts';
import * as configurationWrite from './lib/native-configuration-write.ts';
import * as pluginRead from './lib/native-plugin-read.ts';
import * as pluginInstall from './lib/native-plugin-install.ts';
import * as pluginShare from './lib/native-plugin-share.ts';
import * as marketplace from './lib/native-marketplace.ts';
import * as filesystemRead from './lib/native-filesystem-read.ts';
import * as filesystemWrite from './lib/native-filesystem-write.ts';
import * as sections from './lib/native-section-contract.ts';
import * as storedThread from './lib/native-stored-thread.ts';
import * as threadContent from './lib/native-thread-content.ts';
import * as threadLifecycle from './lib/native-thread-lifecycle.ts';
import * as turnControl from './lib/native-turn-control.ts';
import * as turnWork from './lib/native-turn-work.ts';
import * as feedback from './lib/native-feedback-contract.ts';
import * as metadata from './lib/native-query-contract.ts';
import * as mcpRead from './lib/native-mcp-read.ts';
import * as mcpOAuth from './lib/native-mcp-oauth.ts';
import * as mcpTool from './lib/native-mcp-tool.ts';
import * as windows from './lib/native-windows-sandbox.ts';
import * as watch from './lib/native-filesystem-watch.ts';
import * as shell from './lib/native-thread-shell.ts';
import {readServiceSchema} from './lib/service-schema-packs.ts';
import {nativeWorkflowParams,nativeLoginParams} from './lib/native-agent-contract.ts';
import {assertNativeJsonByteBudget} from './lib/native-input-budget.ts';
import {NativeCommandInputError} from './lib/native-command.ts';
import {prepareNativeRequest} from './lib/native-operation-input.ts';
import {nativeRpcOperation,scopeNativeRpcSchema} from './lib/native-rpc.ts';
import {validateNativeConnection} from './lib/secrets/native-runtime-config.ts';
import {publicNativeMigrationResult} from './lib/secrets/native-migration.ts';

Then('Guardian review events preserve exact action aliases and filesystem permission entries',()=>{
  const notice=guardianFixtureNotice('/workspace');
  const book=new NativeGuardianReviews();book.started(notice.started,'thread_owned','turn_owned');
  const denial=book.completed(notice.completed,'thread_owned','turn_owned');
  assert.equal(book.get({threadId:'thread_owned',reviewId:'review_owned'}).reviewId,'review_owned');
  const convert=action=>nativeGuardianEvent({...denial,action},value=>pathToFileURL(value).href).action;
  assert.deepEqual(convert({type:'command',source:'unifiedExec',command:'printf ok'}),{type:'command',source:'unified_exec',command:'printf ok'});
  assert.deepEqual(convert({type:'execve',program:'/bin/true',argv:[]}),{type:'execve',program:'/bin/true',argv:[]});
  assert.deepEqual(convert({type:'writeStdin',approvalId:'approval',processId:'process',stdin:'x',cwd:'/workspace'}),
    {type:'write_stdin',approval_id:'approval',process_id:'process',stdin:'x',cwd:'file:///workspace'});
  assert.deepEqual(convert({type:'applyPatch',cwd:'/workspace',files:['one']}),{type:'apply_patch',cwd:'/workspace',files:['one']});
  for(const [protocol,wire]of [['socks5Tcp','socks5_tcp'],['socks5Udp','socks5_udp']])
    assert.deepEqual(convert({type:'networkAccess',protocol,host:'localhost',port:80}),{type:'network_access',protocol:wire,host:'localhost',port:80});
  assert.deepEqual(convert({type:'mcpToolCall',toolName:'tool',connectorId:null,connectorName:'name',toolTitle:'title'}),
    {type:'mcp_tool_call',tool_name:'tool',connector_id:null,connector_name:'name',tool_title:'title'});
  const permissions=value=>convert({type:'requestPermissions',permissions:value}).permissions;
  assert.deepEqual(permissions({}),{});assert.deepEqual(permissions({network:null,fileSystem:null}),{network:null,file_system:null});
  const entries=[{access:'read',path:{type:'path',path:'/workspace/one'}},{access:'deny',path:{type:'glob_pattern',pattern:'**/private'}},
    {access:'write',path:{type:'special',value:{kind:'tmpdir'}}}];
  const converted=permissions({fileSystem:{entries,globScanMaxDepth:2}});
  assert.deepEqual(converted,{file_system:{entries:[{access:'read',path:{type:'path',path:'file:///workspace/one'}},entries[1],entries[2]],glob_scan_max_depth:2}});
  converted.file_system.entries[1].path.pattern='changed';assert.equal(entries[1].path.pattern,'**/private');
  assert.deepEqual(permissions({fileSystem:{read:['/workspace/read']}}),{file_system:{entries:[{access:'read',path:{type:'path',path:'file:///workspace/read'}}]}});
  book.forgetThread('unowned_thread');assert.equal(book.get({threadId:'thread_owned',reviewId:'review_owned'}).reviewId,'review_owned');
  book.forgetThread('thread_owned');assert.throws(()=>book.get({threadId:'thread_owned',reviewId:'review_owned'}),/recent denial/);
});

Then('gateway sign-in URLs and public states enforce their complete shape',()=>{
  for(const value of [null,1,'https://example.test/\t','https://example.test/\ud800','x'.repeat(8193),'https://user@example.test/',
    'https://:password@example.test/','https://example.test/#fragment','http://remote.example.test/','ftp://localhost/'])
    assert.throws(()=>nativeGatewayOAuthUrl(value));
  for(const value of ['https://example.test/login','http://localhost:1234/callback','http://127.0.0.1/callback','http://[::1]/callback'])
    assert.equal(nativeGatewayOAuthUrl(value),new URL(value).href);
  const state={providerId:'provider',providerName:'Private display name',required:true,status:null,error:'Private diagnostic'};
  assert.deepEqual(nativeGatewayOAuthState(state),{providerId:'provider',required:true,status:null});
  for(const status of ['notReady','started','succeeded','failed'])assert.equal(nativeGatewayOAuthState({...state,status}).status,status);
  for(const change of [{providerId:1},{providerId:''},{providerId:'x'.repeat(193)},{providerName:1},{providerName:'x'.repeat(513)},
    {required:null},{status:'other'},{error:1}])assert.throws(()=>nativeGatewayOAuthState({...state,...change}));
});

Then('Guardian lifecycle validation requires complete bounded action and permission variants',()=>{
  const uuid='EA31CD52-8CB5-49CE-AC47-49D326182008';
  assert.equal(nativeGuardianParams({threadId:uuid,reviewId:'review'}).threadId,uuid.toLowerCase());
  assert.throws(()=>nativeGuardianParams({threadId:'unowned.thread',reviewId:'review'}),/owned loaded thread/);
  const notice=guardianFixtureNotice('/workspace');
  const start=action=>{const book=new NativeGuardianReviews();book.started({...notice.started,action},'thread_owned','turn_owned');return book;};
  for(const action of [{type:'command',source:'shell',cwd:'/workspace'},
    {...notice.started.action,host:'unexpected'},
    {type:'execve',source:'shell',program:'true',argv:Array.from({length:7},()=> 'x'.repeat(8192)),cwd:'/workspace'}])
    assert.throws(()=>start(action),/Guardian/);
  const permission=path=>({type:'requestPermissions',permissions:{fileSystem:{entries:[{access:'read',path}]}}});
  for(const path of [{type:'path'},{type:'path',path:'/workspace',pattern:'**'},
    {type:'glob_pattern'},{type:'glob_pattern',pattern:'**',path:'/workspace'},
    {type:'special',value:{kind:'root',path:'/workspace'}},
    {type:'special',value:{kind:'unknown'}},{type:'special',value:{kind:'project_roots',path:'/workspace'}}])
    assert.throws(()=>start(permission(path)),/Guardian/);
  for(const path of [{type:'path',path:'/workspace'},{type:'glob_pattern',pattern:'**'},
    {type:'special',value:{kind:'unknown',path:'/workspace',subpath:null}},
    {type:'special',value:{kind:'project_roots',subpath:'src'}},{type:'special',value:{kind:'root'}}]){
    const action=permission(path),book=start(action);
    assert.equal(book.completed({...notice.completed,action,review:{...notice.completed.review,status:'approved'}},'thread_owned','turn_owned'),undefined);
    assert.throws(()=>book.get({threadId:'thread_owned',reviewId:'review_owned'}),/recent denial/);
  }
  const book=start(notice.started.action);
  assert.throws(()=>book.completed({...notice.completed,completedAtMs:0},'thread_owned','turn_owned'),/bounded Guardian lifecycle/);
});

Then('native command contracts enforce bounded plain data and correlated notifications',()=>{
  assert.equal(isNativeQueryMethod('model/list'),true);assert.equal(isNativeQueryMethod('command/exec'),false);assert.equal(isNativeQueryMethod(undefined),false);
  for(const value of [null,[],{},Object.create({cols:80,rows:24})])assert.throws(()=>nativeCommandSize(value));
  assert.throws(()=>nativeCommandBytes(Buffer.alloc(nativeCommandLimits.inputBytes+1).toString('base64')),/16 KiB/);
  for(const value of [null,[],Object.create({command:['true']})])assert.throws(()=>nativeCommandParams('command/exec',value));
  for(const change of [{processId:{}},{cwd:''},{cwd:5},{env:[]},{env:'bad'}])assert.throws(()=>nativeCommandParams('command/exec',{command:['true'],...change}));
  assert.throws(()=>nativeCommandParams('command/exec',{command:['true','x'.repeat(8000),'x'.repeat(8000),'x'.repeat(8000)]}),/16 KiB/);
  const notification={method:nativeCommandOutputMethod,params:{processId:'owned_process',stream:'stdout',deltaBase64:'b2s=',capReached:false}};
  assert.deepEqual(nativeCommandOutput(notification),notification);
  for(const change of [{method:'other'},{emittedAtMs:-1},{emittedAtMs:NaN},{emittedAtMs:1.5}])assert.throws(()=>nativeCommandOutput({...notification,...change}));
  for(const value of [null,false,[],{protocol:'other',stage:'dispatched',processId:null},{protocol:'json-rpc',stage:'unknown',processId:null},
    {protocol:'json-rpc',stage:'dispatched',processId:{}},
    {protocol:'json-rpc',stage:'output',processId:'another_process',notification},
    {protocol:'json-rpc',stage:'output',processId:'owned_process',notification:{}},
    {protocol:'json-rpc',stage:'completed',processId:null,result:{}}])assert.equal(isNativeCommandValue(value),false);
  assert.equal(isNativeCommandValue({protocol:'json-rpc',stage:'output',processId:'owned_process',notification}),true);
});

Then('native input alternatives do not consume the JSON nesting budget or allow recursive schemas',()=>{
  const nested=count=>{
    let value='leaf',schema={type:'string',maxLength:8};
    for(let i=0;i<count;i++){
      value={child:value};schema={anyOf:[{type:'object',properties:{child:schema},required:['child']},{type:'null'}]};
    }
    return {schema,value};
  };
  const allowed=nested(8);assert.deepEqual(nativeBoundedThreadParams(allowed.schema,allowed.value),allowed.value);
  const rejected=nested(9);assert.throws(()=>nativeBoundedThreadParams(rejected.schema,rejected.value));
  const recursive={anyOf:[]};recursive.anyOf.push(recursive);
  assert.throws(()=>nativeBoundedThreadParams(recursive,{}),/declared JSON shape/);
});

Then('native contract entry points reject unknown methods and non-object parameters',()=>{
  const unknown='unreviewed/operation';
  const rejected=[
    ()=>accountActions.nativeAccountActionInputSchema(unknown),()=>accountActions.nativeAccountActionResult(unknown,{}),
    ()=>accountAuth.nativeAccountAuthParams(unknown,{}),()=>accountRead.nativeAccountReadInputSchema(unknown),
    ()=>configurationRead.nativeConfigurationReadParams(unknown,{}),()=>configurationControl.nativeConfigurationControlParams(unknown,{}),
    ()=>configurationWrite.nativeConfigurationWriteParams(unknown,{}),()=>pluginRead.nativePluginReadParams(unknown,{}),
    ()=>pluginInstall.nativePluginInstallParams(unknown,{}),()=>pluginShare.nativePluginShareParams(unknown,{}),
    ()=>marketplace.nativeMarketplaceParams(unknown,{}),()=>filesystemRead.nativeFilesystemReadParams(unknown,{}),
    ()=>filesystemWrite.nativeFilesystemWriteParams(unknown,{}),()=>sections.nativeSectionParams(unknown,{}),
    ()=>storedThread.nativeStoredThreadReadInputSchema(unknown),()=>threadContent.nativeThreadContentInputSchema(unknown),
    ()=>threadLifecycle.nativeThreadLifecycleInputSchema(unknown),()=>turnControl.nativeTurnControlParams(unknown,{}),
    ()=>turnWork.nativeTurnWorkParams(unknown,{}),()=>windows.nativeWindowsSandboxParams(unknown,{}),
    ()=>feedback.nativeFeedbackParams([]),()=>metadata.nativeQueryParams('model/list',[]),
    ()=>mcpRead.nativeMcpReadParams('mcpServer/resource/read',[]),()=>mcpOAuth.nativeMcpOAuthParams([]),
    ()=>mcpTool.nativeMcpToolParams([]),
  ];
  for(const reject of rejected)assert.throws(reject);
  for(const source of [null,[],{}, {type:'array',properties:{}},{type:'object',properties:[]}])
    assert.throws(()=>account.nativeAccountWorkflowResultSchema(source),/account result schema/);
  assert.throws(()=>storedThread.nativeStoredThreadReadResultSchema('thread/read',{}),/result schema/);
  assert.throws(()=>storedThread.nativeStoredThreadMetadataSchema({}),/metadata schema/);
  assert.throws(()=>threadContent.nativeThreadContentResultSchema(threadContent.nativeThreadContentMethods[0],{}),/result schema/);
  assert.throws(()=>threadLifecycle.nativeThreadLifecycleResultSchema(threadLifecycle.nativeThreadLifecycleMethods[0],{}),/result schema/);
});

Then('native configuration reads retain field bounds and reject malformed public projections',async()=>{
  for(const [method,input,field]of [
    ['config/read',{unreviewed:true},'unreviewed'],['config/read',{cwd:''},'cwd'],['config/read',{cwd:'x'.repeat(4097)},'cwd'],
    ['config/read',{includeLayers:null},'includeLayers'],['experimentalFeature/list',{cursor:1},'cursor'],
    ['experimentalFeature/list',{threadId:'bad.thread'},'threadId'],...[-1,1.5,65].map(limit=>['experimentalFeature/list',{limit},'limit']),
    ['skills/list',{forceReload:1},'forceReload'],['skills/list',{cwds:null},'cwds'],['skills/list',{cwds:Array(9).fill('/workspace')},'cwds'],
    ['skills/list',{cwds:['']},'cwds'],['skills/list',{cwds:Array(8).fill('/'+ 'x'.repeat(4095))},'params'],
  ])assert.throws(()=>configurationRead.nativeConfigurationReadParams(method,input),error=>error.field===field);
  for(const source of [null,[],{}, {config:[],origins:{}},{config:{},origins:[]}])
    assert.throws(()=>configurationRead.publicNativeConfigurationResult(source));
  for(const layers of [{},[null],[{}]])assert.throws(()=>configurationRead.publicNativeConfigurationResult({config:{},origins:{},layers}));
  const document=await readServiceSchema('codex');
  for(const path of [['definitions'],['definitions','v2'],['definitions','v2','Config'],['definitions','v2','Config','properties'],
    ['definitions','v2','ConfigReadResponse'],['definitions','v2','ConfigReadResponse','properties'],
    ['definitions','v2','ConfigLayer'],['definitions','v2','ConfigLayer','properties']]){
    const changed=structuredClone(document);let owner=changed;for(const key of path.slice(0,-1))owner=owner[key];delete owner[path.at(-1)];
    assert.throws(()=>configurationRead.nativeConfigurationReadResultSchema(changed),/require requalification/);
  }
  const changed=structuredClone(document);changed.definitions.v2.Config.properties.model=null;
  assert.throws(()=>configurationRead.nativeConfigurationReadResultSchema(changed),/field is missing/);
  const safe=configurationRead.publicNativeConfigurationResult({config:{model:'owned',api_key:'withheld'},origins:{model:{source:'user'},api_key:{source:'private'}},layers:null});
  assert.deepEqual(safe,{config:{model:'owned'},origins:{model:{source:'user'}},layers:null});
});

Then('native configuration writes and controls reject invalid edits oversized envelopes and unsafe fingerprint data',async()=>{
  const edit={keyPath:'model',value:'owned',mergeStrategy:'replace'};
  for(const raw of [null,[],{...edit,extra:true},{keyPath:'model',mergeStrategy:'replace'}])
    assert.throws(()=>configurationWrite.nativeConfigurationWriteParams('config/batchWrite',{edits:[raw]}));
  for(const [method,input]of [
    ['config/batchWrite',{edits:[],reloadUserConfig:null}],['skills/config/write',{name:'\u2003',enabled:true}],
    ['config/value/write',{...edit,filePath:1}],['config/value/write',{...edit,expectedVersion:'x'.repeat(513)}],
    ['skills/config/write',{name:'x'.repeat(193),enabled:true}],
    ['config/batchWrite',{edits:Array(16).fill({...edit,value:'漢'.repeat(128)}),filePath:'/'+ '漢'.repeat(4095),expectedVersion:'漢'.repeat(512)}],
  ])assert.throws(()=>configurationWrite.nativeConfigurationWriteParams(method,input));
  assert.deepEqual(configurationWrite.nativeConfigurationWriteParams('config/batchWrite',{edits:[],filePath:'/workspace/config.toml',expectedVersion:'owned'}),
    {edits:[],reloadUserConfig:false,filePath:'/workspace/config.toml',expectedVersion:'owned'});
  for(const input of [{enablement:[]},{enablement:{unknown:true}},{enablement:{memories:1}},{enablement:{},unknown:true}])
    assert.throws(()=>configurationControl.nativeConfigurationControlParams('experimentalFeature/enablement/set',input));
  assert.throws(()=>configurationControl.nativeConfigurationControlParams('skills/extraRoots/set',{extraRoots:Array(8).fill('/'+'x'.repeat(4095))}),/16 KiB/);
  let depth='leaf';for(let i=0;i<33;i++)depth={child:depth};
  for(const value of [depth,Object.fromEntries(Array.from({length:8193},(_,i)=>['key'+i,i])),new Date(),()=>{}, {[Symbol('private')]:true}])
    await assert.rejects(configurationWrite.nativeConfigurationWriteHash(value));
  let reads=0;const accessor={get value(){reads++;return 'private';}};
  await assert.rejects(configurationWrite.nativeConfigurationWriteHash(accessor));assert.equal(reads,0);
});

Then('native workflow dispatch preserves plugin marketplace readiness and thread control contracts',()=>{
  const uuid='EA31CD52-8CB5-49CE-AC47-49D326182008';
  const fixtures=[
    [windows.nativeWindowsSandboxReadinessMethod,{},{}],
    ['plugin/share/save',{pluginPath:'/workspace/plugin'},{pluginPath:'/workspace/plugin'}],
    ['plugin/install',{pluginName:'owned',marketplacePath:'/workspace/marketplace.json'},{pluginName:'owned',marketplacePath:'/workspace/marketplace.json'}],
    ['marketplace/add',{source:'/workspace/marketplace'},{source:'/workspace/marketplace'}],
    ['turn/interrupt',{threadId:uuid,turnId:''},{threadId:uuid.toLowerCase(),turnId:''}],
    ['thread/goal/set',{threadId:'owned_thread',objective:'Review ownership'},{threadId:'owned_thread',objective:'Review ownership'}],
  ];
  for(const [method,input,expected]of fixtures)assert.deepEqual(nativeWorkflowParams(method,input),expected);
  assert.deepEqual(nativeLoginParams({type:'chatgpt',appBrand:null,codexStreamlinedLogin:false,useHostedLoginSuccessPage:true}),
    {type:'chatgpt',appBrand:null,codexStreamlinedLogin:false,useHostedLoginSuccessPage:true});
  for(const input of [{appBrand:'other'},{appBrand:1},{codexStreamlinedLogin:null},{useHostedLoginSuccessPage:'yes'}])
    assert.throws(()=>nativeLoginParams({type:'chatgpt',...input}),/browser sign-in/);
  const controlled={threadId:uuid,expectedTurnId:uuid,input:[{type:'text',text:'λ',text_elements:[{byteRange:{start:0,end:2}}]}]};
  assert.equal(turnControl.nativeTurnControlParams('turn/steer',controlled).expectedTurnId,uuid.toLowerCase());
  for(const range of [{start:2,end:1},{start:0,end:3}])assert.throws(()=>turnControl.nativeTurnControlParams('turn/steer',{
    ...controlled,input:[{type:'text',text:'λ',text_elements:[{byteRange:range}]}]}),/UTF-8/);
});

Then('plugin and marketplace parameters reject malformed selectors and oversized collections',()=>{
  for(const input of [{},{pluginName:null}])assert.throws(()=>pluginInstall.nativePluginInstallParams('plugin/install',input));
  for(const input of [{pluginName:'owned',marketplacePath:'/workspace/m',unknown:true},{pluginName:'',marketplacePath:'/workspace/m'},
    {pluginName:'owned',marketplacePath:1}])assert.throws(()=>pluginRead.nativePluginReadParams('plugin/read',input));
  for(const input of [{cwds:'bad'},{installSuggestionPluginNames:Array(33).fill('owned')},{marketplaceKinds:['unreviewed']},
    {forceRefetch:null},{cwds:Array(8).fill('/'+'x'.repeat(4095))}])assert.throws(()=>pluginRead.nativePluginReadParams('plugin/list',input));
  for(const input of [{source:'owned',sparsePaths:'bad'},{source:'owned',sparsePaths:Array(33).fill('source')},
    {source:'owned',sparsePaths:Array(32).fill('x'.repeat(1024))}])assert.throws(()=>marketplace.nativeMarketplaceParams('marketplace/add',input));
  for(const [method,input]of [
    ['plugin/share/save',{pluginPath:'/workspace/plugin',discoverability:'LISTED'}],
    ['plugin/share/updateTargets',{remotePluginId:'owned_plugin',discoverability:'unknown',shareTargets:[]}],
    ['plugin/share/save',{pluginPath:'/workspace/plugin',shareTargets:{}}],
    ['plugin/share/save',{pluginPath:'/workspace/plugin',shareTargets:[null]}],
    ['plugin/share/updateTargets',{remotePluginId:'owned_plugin',discoverability:'PRIVATE',shareTargets:Array(64).fill({principalType:'user',principalId:'x'.repeat(512),role:'reader'})}],
  ])assert.throws(()=>pluginShare.nativePluginShareParams(method,input));
  const maximum={pluginName:'漢'.repeat(512),marketplacePath:'漢'.repeat(4096),installAttemptId:'漢'.repeat(128)};
  assert.deepEqual(pluginInstall.nativePluginInstallParams('plugin/install',maximum),maximum);
  assert.ok(new TextEncoder().encode(JSON.stringify(maximum)).byteLength<16384,'Per-field maxima remain below the installation envelope budget');
});

Then('native JSON metadata thread and MCP contracts reject oversized malformed and ambiguous values',()=>{
  for(const shape of [{type:['string','integer']},{type:'number'},{}])assert.throws(()=>metadata.nativeQueryFieldSchema(shape),/Unsupported/);
  let schema={type:'string'};for(let i=0;i<9;i++)schema={type:'object',properties:{child:schema}};
  assert.throws(()=>metadata.nativeQueryFieldSchema(schema),/Unsupported/);
  assert.throws(()=>metadata.nativeQueryParams('app/read',{appIds:Array(100).fill('x'.repeat(512))}),/frame budget/);
  assert.throws(()=>storedThread.nativeStoredThreadReadParams('thread/list',{cwd:Array(8).fill('/'+'x'.repeat(4095))}),/16 KiB/);
  const foreign=new Error('Owned schema fixture failure'),throwing={get type(){throw foreign;}};
  assert.throws(()=>nativeBoundedThreadParams({anyOf:[throwing]},{}),error=>error===foreign);
  assert.throws(()=>nativeBoundedThreadParams({type:'string'},'x'.repeat(2049)),/2048/);
  assert.throws(()=>nativeBoundedThreadParams({type:'object',properties:{},required:[]},Object.create({foreign:true})),/plain own fields/);
  assert.throws(()=>nativeBoundedThreadParams({type:'object',properties:{settings:{type:'object',properties:{required:{type:'string'}},required:['required']}},required:['settings']},
    {settings:{}}),error=>error.field==='settings');
  let nested='leaf';for(let i=0;i<25;i++)nested={child:nested};
  const large=Object.fromEntries(Array.from({length:4097},(_,i)=>['key'+i,i]));
  for(const value of [nested,large,{'\ud800':true}]){
    assert.throws(()=>mcpTool.nativeMcpToolParams({threadId:'owned',server:'owned',tool:'owned',arguments:value}));
    assert.throws(()=>threadContent.nativeThreadContentParams('thread/attachment/add',{threadId:'owned',attachmentType:'owned',identityKey:'owned',payload:value}));
  }
  assert.throws(()=>threadContent.nativeThreadContentParams('thread/attachment/add',{threadId:'owned',attachmentType:'owned',identityKey:'owned',payload:'x'.repeat(32768)}),/32 KiB/);
  assert.throws(()=>threadContent.nativeThreadContentParams('thread/attachment/add',null),/plain thread fields/);
  for(const objective of [1,'\u2003','\ud800','bad\u000bvalue','x'.repeat(8193)])
    assert.throws(()=>threadContent.nativeThreadContentParams('thread/goal/set',{threadId:'owned',objective}),/objective/);
  for(const value of [null,{},[]])assert.throws(()=>filesystemRead.nativeReadFileBytes(value),/file response/);
});

Then('native JSON envelope budgets preserve exact boundaries fields and error constructors',()=>{
  assertNativeJsonByteBudget('λ',4,NativeCommandInputError,'params','Owned envelope limit.');
  assert.throws(()=>assertNativeJsonByteBudget('λ',3,NativeCommandInputError,'params','Owned envelope limit.'),
    error=>error instanceof NativeCommandInputError&&error.field==='params'&&error.message==='Owned envelope limit.');
  assertNativeJsonByteBudget(null,4,Error,'Owned serialized limit.');
  assert.throws(()=>assertNativeJsonByteBudget(null,3,Error,'Owned serialized limit.'),
    error=>error.constructor===Error&&error.message==='Owned serialized limit.');
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>assertNativeJsonByteBudget(cyclic,1024,NativeCommandInputError,'params','Not a JSON value.'),TypeError);
});

Then('native MCP and watch parsers retain malformed collection and protocol boundaries',()=>{
  assert.equal(mcpRead.nativeMcpReadParams('mcpServerStatus/list',{cursor:''}).cursor,'');
  for(const cursor of [1,'\ud800','x'.repeat(2049),'bad\nvalue'])
    assert.throws(()=>mcpRead.nativeMcpReadParams('mcpServerStatus/list',{cursor}),error=>error.field==='cursor');
  for(const contents of [null,{},Array(65).fill({text:'bounded'})])
    assert.throws(()=>mcpRead.nativeMcpResourceBodies({contents}),/inventory/);
  const bodies=mcpTool.nativeMcpToolBodies({content:[null,[],1,false,'unclassified',{type:'text',text:'owned text'}]});
  assert.deepEqual(bodies.map(body=>new TextDecoder().decode(body)),['owned text']);
  for(const value of [null,1,[]])assert.throws(()=>new mcpOAuth.NativeMcpOAuthCorrelation({name:'owned'}).complete(value),/completion/);
  for(const path of [1,'','\ud800','x'.repeat(4097)])assert.throws(()=>watch.nativeFilesystemWatchResult({path}),/acknowledgement/);
  assert.equal(watch.isNativeFilesystemWatchValue({protocol:'http',result:{path:'/owned/watch'}}),false);
});

Then('native turn and thread lifecycle bounds retain UUID revision remote and byte semantics',()=>{
  const threadId='AA717179-5E10-4792-B068-79B7F0D20EE1';
  assert.equal(turnWork.nativeTurnWorkParams('thread/compact/start',{threadId}).threadId,threadId.toLowerCase());
  assert.throws(()=>turnWork.nativeTurnWorkParams('thread/compact/start',{threadId:'invalid/id'}),error=>error.field==='threadId');
  for(const [type,key]of [['baseBranch','branch'],['commit','sha'],['custom','instructions']])
    assert.throws(()=>turnWork.nativeTurnWorkParams('review/start',{threadId:'owned',target:{type,[key]:'\u2003'}}),error=>error.field==='target');
  assert.throws(()=>turnWork.nativeTurnWorkParams('review/start',{threadId:'owned',target:{type:'custom',instructions:'漢'.repeat(12000)}}),/32 KiB/);
  for(const originUrl of ['ftp://example.test/repo','https://user:password@example.test/repo','https://example.test/repo?token=private',
    'https://example.test/repo#private','https://user@example.test/repo'])
    assert.throws(()=>threadLifecycle.nativeThreadLifecycleParams('thread/metadata/update',{threadId:'owned',gitInfo:{originUrl}}),error=>error.field==='gitInfo');
  const maximal={threadId:'t'.repeat(192),gitInfo:{sha:'漢'.repeat(512),branch:'漢'.repeat(512),originUrl:'ssh://git@example.test/'+ '漢'.repeat(2000)}};
  assert.ok(Buffer.byteLength(JSON.stringify(maximal))<16384);
  assert.deepEqual(threadLifecycle.nativeThreadLifecycleParams('thread/metadata/update',maximal),maximal);
  for(const value of [1,[]])assert.throws(()=>windows.nativeWindowsSandboxParams(windows.nativeWindowsSandboxReadinessMethod,value),error=>error.field==='params');
  for(const cwd of [1,'\u2003','\ud800','x'.repeat(4097),'/owned/\nprivate'])
    assert.throws(()=>windows.nativeWindowsSandboxParams(windows.nativeWindowsSandboxSetupMethod,{mode:'elevated',cwd}),error=>error.field==='cwd');
});

Then('native thread shell declarations and items retain exact owned shapes and timeout bounds',async()=>{
  for(const value of [null,{},[],{threadId:'owned',command:'true',extra:true}])assert.throws(()=>shell.nativeThreadShellParams(value),error=>error.field==='params');
  assert.throws(()=>shell.nativeThreadShellParams({threadId:'invalid/id',command:'true'}),error=>error.field==='threadId');
  for(const timeoutMs of [null,-1,1.5,300001])assert.throws(()=>shell.nativeThreadShellParams({threadId:'owned',command:'true',timeoutMs}),error=>error.field==='timeoutMs');
  assert.deepEqual(shell.nativeThreadShellParams({threadId:'owned',command:' true ',timeoutMs:0}),{threadId:'owned',command:'true',timeoutMs:0});
  const source=await readServiceSchema('codex');
  for(const change of [document=>delete document.definitions.v2.ThreadItem,
    document=>delete document.definitions.v2.ItemCompletedNotification,
    document=>delete document.definitions.v2.ItemCompletedNotification.properties]){
    const document=structuredClone(source);change(document);assert.throws(()=>shell.nativeThreadShellResultSchema(document),/requalification/);
  }
  const frame={method:'item/started',params:{threadId:'thread_owned',turnId:'turn_owned',item:{id:'item_owned',type:'commandExecution',source:'userShell',command:'true',cwd:'/owned',commandActions:[],status:'inProgress'}}};
  assert.deepEqual(shell.nativeThreadShellItem(frame,'thread_owned','turn_owned','started'),frame);
  for(const changed of [{...frame,params:null},{...frame,params:{...frame.params,threadId:'foreign'}},
    {...frame,params:{...frame.params,turnId:'foreign'}},{...frame,method:'item/completed'},{...frame,params:{...frame.params,item:null}}])
    assert.throws(()=>shell.nativeThreadShellItem(changed,'thread_owned','turn_owned','started'),/Unowned/);
});

Then('native feedback filesystem and section inputs retain named malformed value and byte limits',()=>{
  for(const reason of [1,'\ud800','\u000b','x'.repeat(8193)])assert.throws(()=>feedback.nativeFeedbackParams({classification:'bug',reason}),/message/);
  for(const threadId of [1,'','invalid/id','x'.repeat(193)])assert.throws(()=>feedback.nativeFeedbackParams({classification:'bug',threadId}),/thread/);
  for(const tags of [1,[]])assert.throws(()=>feedback.nativeFeedbackParams({classification:'bug',tags}),/tags/);
  const largeFeedback={classification:'bug',reason:'漢'.repeat(8192),tags:Object.fromEntries(Array.from({length:4},(_,index)=>['tag'+index,'漢'.repeat(1024)]))};
  assert.throws(()=>feedback.nativeFeedbackParams(largeFeedback),/frame budget/);
  assert.throws(()=>filesystemRead.nativeFilesystemReadParams('fs/readFile',{path:'.',headers:{}}),/Unsupported/);
  for(const value of [{query:1,roots:['.']},{query:'x',roots:null},{query:'x',roots:Array(9).fill('.')},
    {query:'x',roots:['']},{query:'x',roots:['.'],cancellationToken:1}])
    assert.throws(()=>filesystemRead.nativeFilesystemReadParams('fuzzyFileSearch',value),/search/);
  for(const path of [1,'','\ud800','x'.repeat(4097),'/owned/\nprivate']){
    assert.throws(()=>filesystemRead.nativeFilesystemReadParams('fs/readFile',{path}),/path/);
    assert.throws(()=>filesystemWrite.nativeFilesystemWriteParams('fs/createDirectory',{path}),/path/);
  }
  for(const appearance of [1,[]])assert.throws(()=>sections.nativeSectionParams('threadSection/create',{name:'owned',appearance}),error=>error.field==='appearance');
  assert.throws(()=>pluginRead.nativePluginReadParams('plugin/read',{}),error=>error.field==='pluginName');
});

Then('prepared native operations preserve specialized parameter adapters and precise public diagnostics',async()=>{
  const source=await readServiceSchema('codex'),selection=method=>{
    const document=scopeNativeRpcSchema(source,method);return nativeRpcOperation(document,'codex:'+method);
  };
  const cases=[['turn/interrupt',{threadId:'owned',turnId:crypto.randomUUID()}],['thread/name/set',{threadId:'owned',name:'Owned thread'}],
    ['thread/loaded/list',{}],['config/value/write',{keyPath:'model',value:'owned',mergeStrategy:'replace'}],['config/mcpServer/reload',{}],
    ['windowsSandbox/readiness',{}],['plugin/share/save',{pluginPath:'/owned/plugin'}],['plugin/install',{pluginName:'owned',marketplacePath:'/owned/marketplace'}],
    ['marketplace/add',{source:'owner/repository'}],['plugin/read',{pluginName:'owned',marketplacePath:'/owned/marketplace'}],['config/read',{}]];
  const values=(operation,params)=>Object.fromEntries(Object.entries(params).map(([name,value])=>{
    const field=operation.fields.find(field=>field.name===name);assert.ok(field,'Missing reviewed parameter '+name);
    return [field.key,field.type==='string'?value:JSON.stringify(value)];
  }));
  for(const [method,params]of cases){
    const operation=selection(method);
    assert.deepEqual(prepareNativeRequest(operation,values(operation,params)),{protocol:'json-rpc',method,params:nativeWorkflowParams(method,params)});
  }
  assert.throws(()=>prepareNativeRequest(selection('feedback/upload'),{}),error=>error.fieldKey==='params'&&/Feedback requires/.test(error.message));
  assert.throws(()=>prepareNativeRequest(selection('fs/getMetadata'),{'params:path':'\0'}),error=>error.fieldKey==='params'&&/Native inputs/.test(error.message));
  const sharing=selection('plugin/share/save'),oversized={pluginPath:'/owned/plugin',shareTargets:Array.from({length:64},()=>({principalType:'user',principalId:'漢'.repeat(256),role:'reader'}))};
  assert.throws(()=>prepareNativeRequest(sharing,values(sharing,oversized)),error=>error.fieldKey==='params'&&/32 KiB/.test(error.message));
  assert.throws(()=>prepareNativeRequest(selection('threadSection/create'),{'params:name':'owned','params:appearance':JSON.stringify({color:'漢'.repeat(40)})}),error=>error.fieldKey==='params:appearance');
});

Then('native optional metadata preserves omitted layers no-auth targets legacy pairings and classified migration text',()=>{
  assert.deepEqual(configurationRead.publicNativeConfigurationResult({config:{model:'owned'},origins:{}}),{config:{model:'owned'},origins:{}});
  const target={server:'codex_apps',uri:'owned:resource',target:{connectorId:'owned',linkId:null}};
  assert.deepEqual(mcpRead.nativeMcpReadParams('mcpServer/resource/read',target),target);
  const connectedTarget={...target,target:{connectorId:'owned',linkId:'owned_account_link'}};
  assert.deepEqual(mcpRead.nativeMcpReadParams('mcpServer/resource/read',connectedTarget),connectedTarget);
  const migration={items:[{itemType:'CONFIG',description:'Owned configuration',details:null}]};
  assert.deepEqual(publicNativeMigrationResult('externalAgentConfig/detect',migration),migration);
  const legacy={id:crypto.randomUUID(),revision:1,fingerprint:'a'.repeat(64),profile:nativeRuntimeProfile,label:'Owned legacy pairing',host:'https://owned.example.test',
    pairingKeyId:crypto.randomUUID(),keyHash:'b'.repeat(64),modelFingerprint:'c'.repeat(64),accountType:'none',identity:{runtimeId:crypto.randomUUID(),generation:crypto.randomUUID(),
      accountEpoch:crypto.randomUUID(),version:nativeRuntimeVersion,configuration:'d'.repeat(64),workspace:'e'.repeat(64)}};
  assert.deepEqual(validateNativeConnection(legacy),legacy);
  assert.throws(()=>turnControl.nativeTurnControlParams('turn/interrupt',{threadId:'invalid/id',turnId:'owned'}),error=>error.field==='threadId');
  const objective='漢'.repeat(8192);assert.equal(threadContent.nativeThreadContentParams('thread/goal/set',{threadId:'owned',objective}).objective,objective);
});

Then('native schema qualification and batch writes retain declaration and plain-data guards',async()=>{
  const source=await readServiceSchema('codex'),missing=structuredClone(source);delete missing.definitions.v2;
  assert.throws(()=>scopeNativeRpcSchema(missing,'account/read'));
  const scoped=scopeNativeRpcSchema(source,'fs/getMetadata'),operation=nativeRpcOperation(scoped,'codex:fs/getMetadata');
  const parts=operation.rpc.workflowResult.$ref.slice(2).split('/'),unqualified=structuredClone(source);let parent=unqualified;
  for(const part of parts.slice(0,-1))parent=parent[part];delete parent[parts.at(-1)];
  assert.throws(()=>scopeNativeRpcSchema(unqualified,'fs/getMetadata'),/workflow result schema is unavailable/);
  assert.throws(()=>configurationWrite.nativeConfigurationWriteParams('config/value/write',{keyPath:'model',value:'owned',mergeStrategy:'replace',extra:true}),error=>error.field==='extra');
  let invoked=false;const edit={keyPath:'model',value:'owned'};
  Object.defineProperty(edit,'mergeStrategy',{enumerable:true,get(){invoked=true;return 'replace';}});
  assert.throws(()=>configurationWrite.nativeConfigurationWriteParams('config/batchWrite',{edits:[edit]}),error=>!(error instanceof NativeCommandInputError)&&/native runtime contract/.test(error.message));
  assert.equal(invoked,false);
});
