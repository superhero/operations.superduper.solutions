// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { parseWorkflowFile as parse, fileValueType, decodeWorkflowFile as decode,
  validateWorkflowFileData as validate, csvOptions, defaultCsvOptions as defaults } from './lib/workflow-file.ts';
Then('uploaded JSON preserves native values and types', function () {
  assert.equal(fileValueType(), 'Unknown');
  for (const [value,type] of [[null,'Null'],[true,'Boolean'],['hello','Text'],[1,'Integer'],[1.5,'Number'],[{},'Object'],[[],'Array']]) {
    const file = parse('DATA.JSON', JSON.stringify(value));
    assert.deepEqual(file.value,value); assert.equal(fileValueType(file),type);
    assert.deepEqual(validate({file:JSON.parse(JSON.stringify(file))}),{file});
  }
  assert.deepEqual(parse('data.json','\uFEFF{"__proto__":{"safe":true}}').value,JSON.parse('{"__proto__":{"safe":true}}'));
});
Then('uploaded CSV supports common delimiters quotes headers and line endings', function () {
  assert.equal(defaults.quote,'auto');
  assert.deepEqual(parse('auto.csv',"name;note\nAlice;'one;two'").value,[{name:'Alice',note:'one;two'}]);
  assert.deepEqual(parse('auto.csv',"name,note\nAlice,don't change this").value,[{name:'Alice',note:"don't change this"}]);
  for (const delimiter of [',',';','\t','|']) for (const eol of ['\n','\r\n','\r']) {
    const file=parse('rows.csv',`id${delimiter}name${eol}00123${delimiter}Alice${eol}`);
    assert.equal(file.delimiter,delimiter); assert.deepEqual(file.value,[{id:'00123',name:'Alice'}]);
    assert.equal(fileValueType(file),'Array');
  }
  assert.deepEqual(parse('rows.csv','sep=;\r\nid;name\r\n1;A').value,[{id:'1',name:'A'}]);
  assert.deepEqual(parse('rows.csv','name,note\nA,"one, two\nand ""three"""').value,[{name:'A',note:'one, two\nand "three"'}]);
  assert.deepEqual(parse('rows.csv',"name;note\nA;'one;two'",{...defaults,quote:"'"}).value,[{name:'A',note:'one;two'}]);
  assert.deepEqual(parse('rows.csv','alpha,beta\ngamma,delta',{...defaults,header:'absent'}).value,[['alpha','beta'],['gamma','delta']]);
  assert.deepEqual(parse('rows.csv','1,2\n3,4').value,[['1','2'],['3','4']]);
  assert.deepEqual(parse('rows.csv','name',{...defaults,header:'present'}).value,[]);
  assert.deepEqual(parse('rows.csv','single').value,[['single']]);
  for (const delimiter of [',',';','\t','|']) {
    const source=`name${delimiter}note\r\nAlice${delimiter}"literal\r\nBob${delimiter}'text'`;
    for (const selection of ['auto',delimiter]) {
      const file=parse('rows.csv',source,{...defaults,delimiter:selection,quote:'none'});
      assert.deepEqual(file.value,[{name:'Alice',note:'"literal'},{name:'Bob',note:"'text'"}]);
      assert.equal(validate({file}).file.options.quote,'none');
    }
  }
  assert.deepEqual(parse('rows.csv','name,note\nAlice,00123').value,[{name:'Alice',note:'00123'}]);
  assert.deepEqual(parse('rows.csv','a,a\n1,2').value,[['a','a'],['1','2']]);
  assert.deepEqual(parse('rows.csv','a,,b\n1,2,3').value,[['a','','b'],['1','2','3']]);
  assert.deepEqual(parse('rows.csv','sep=;\na,b\n1,2',{...defaults,delimiter:','}).value,[{a:'1',b:'2'}]);
});
Then('workflow uploads reject unsupported malformed and excessive data', function () {
  for (const [name,source] of [['data.txt','{}'],['data.json','{'],['data.json','1e999'],['data.csv',''],['data.csv','a\u0000b'],['data.json',' '.repeat(500001)],['data.csv','a,b\n1'],['data.csv','a,b\n"unfinished'],['data.csv','x\n'.repeat(10001)],['data.csv',Array(1001).fill('x').join(',')]]) assert.throws(()=>parse(name,source));
  for (const source of ['a,a\n1,2',',b\n1,2']) assert.throws(()=>parse('a.csv',source,{...defaults,header:'present'}));
  for (const options of [null,{}, {...defaults,delimiter:':'},{...defaults,header:'bad'},{...defaults,quote:'!'}]) assert.throws(()=>csvOptions(options));
  assert.throws(()=>parse('a.json','['.repeat(50)+'0'+']'.repeat(50)));
  assert.throws(()=>parse('a.json',JSON.stringify(Array(100001).fill(0))));
});
Then('workflow uploads decode supported text encodings and validate saved data', function () {
  assert.deepEqual(decode(new TextEncoder().encode('hello')),{source:'hello',encoding:'utf-8'});
  assert.deepEqual(decode(Uint8Array.of(255,254,65,0)),{source:'A',encoding:'utf-16le'});
  assert.deepEqual(decode(Uint8Array.of(254,255,0,65)),{source:'A',encoding:'utf-16be'});
  assert.deepEqual(decode(Uint8Array.of(233)),{source:'é',encoding:'windows-1252'});
  assert.throws(()=>decode(Uint8Array.of(255,254,65)));
  assert.throws(()=>decode(new Uint8Array(500001)));
  assert.deepEqual(validate({}),{});
  const file=parse('data.json','{}');
  for (const invalid of [null,{}, {...file,name:''},{...file,name:'x'.repeat(256)}, {...file,format:'pdf'}, {...file,name:'x.csv'}, {...file,source:4}, {...file,source:'x'.repeat(500001)}, {...file,delimiter:4}, {...file,header:4}, {...file,encoding:4}, {...file,value:undefined}, {...file,value:new Date()}]) assert.throws(()=>validate({file:invalid}));
});

Then('uploaded file nodes persist and supply operation inputs', async function () {
  const { operations } = await import('./lib/catalog.ts');
  const { createOperationGraph, createUtilityNode, isWorkflowConnection } = await import('./lib/workflow-graph.ts');
  const { validateWorkflowDocument, parseWorkflowDocument } = await import('./lib/workflow-document.ts');
  const { createWorkflowRunner } = await import('./lib/workflow-runner.ts');
  const { createWorkflowDemo } = await import('./lib/workflow-demo.ts');
  const demo = (await import('./catalogs/demo.openapi.json', {with:{type:'json'}})).default;
  const graph = createOperationGraph(operations.find(op=>op.id==='demo:getProject'),{x:0,y:0},'get',demo);
  const node=createUtilityNode('file',{x:0,y:0},'file');
  node.data={file:parse('id.json','"project-1"')};
  const input=graph.nodes.find(n=>n.type==='data' && n.data.direction==='inputs' && n.data.fields.some(f=>f.label==='Project ID'));
  const field=input.data.fields.find(f=>f.label==='Project ID');
  const edge={id:'file-input',kind:'mapping',source:'file',sourceHandle:'value',target:input.id,targetHandle:field.id};
  const doc={version:3,id:'uploaded-file',name:'Upload',nodes:[node,...graph.nodes],edges:[...graph.edges,edge],viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false};
  assert.equal(isWorkflowConnection(edge,doc.nodes,graph.edges),true);
  const saved=parseWorkflowDocument(JSON.stringify(validateWorkflowDocument(doc)));
  assert.deepEqual(saved.nodes.find(n=>n.type==='file').data,node.data);
  for (const start of [undefined,'get']) {
    const runner=createWorkflowRunner(saved,start,createWorkflowDemo());
    const visit=runner.next(); assert.equal(visit.kind,'operation'); assert.equal(visit.values['path:projectId'],'project-1');
    await runner.submit(visit.values); assert.equal(runner.next().kind,'complete');
  }
  for (const hidden of [false,true]) {
    const unconnected={...saved,nodes:[...saved.nodes,{id:'empty',type:'file',position:{x:0,y:0},hidden,data:{}}]};
    assert.equal(createWorkflowRunner(unconnected,undefined,createWorkflowDemo()).next().kind,'operation');
  }
  for (const value of [1,{},[],true,null]) {
    node.data={file:parse('id.json',JSON.stringify(value))};
    assert.equal(isWorkflowConnection(edge,doc.nodes,graph.edges),false);
  }
  node.data={}; assert.equal(isWorkflowConnection(edge,doc.nodes,graph.edges),false);
  // Saved malformed connections are rejected before execution, never treated as a usable file.
  assert.throws(()=>validateWorkflowDocument(doc));
});
Then('file node types propagate through switches and change descriptions', async function () {
  const { routingInputTypes, isWorkflowConnectionTypeCompatible }=await import('./lib/workflow-utilities.ts');
  const { describeWorkflowChange }=await import('./lib/workflow-change-message.ts');
  const position={x:0,y:0};
  const empty={version:3,id:'files',name:'Files',nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false};
  const nodes=[{id:'file',type:'file',position,data:{file:parse('a.json','1')}},{id:'switch',type:'switch',position,data:{gates:[{id:'gate',operator:'==',value:'1'}]}}];
  const edge={id:'mapping',kind:'mapping',source:'file',sourceHandle:'value',target:'switch',targetHandle:'value'};
  assert.equal(routingInputTypes(nodes,[edge]).get('switch'),'Number');
  assert.equal(isWorkflowConnectionTypeCompatible(edge,nodes,[edge]),true);
  nodes[0].data.file=parse('a.json','"one"');
  assert.equal(routingInputTypes(nodes,[edge]).get('switch'),'Text');
  const added={...empty,nodes:[nodes[0]]};
  assert.match(describeWorkflowChange(empty,added),/File upload/);
  const replaced=structuredClone(added); replaced.nodes[0].data.file=parse('a.csv','1,2');
  assert.match(describeWorkflowChange(added,replaced),/Update file upload/);
});
Then('uploaded CSV rows execute as structured request data', async function () {
  const {extractOperations,updateCatalogs}=await import('./lib/catalog.ts');
  const {catalogs}=await import('./lib/catalog-registry.ts');
  const {createOperationGraph}=await import('./lib/workflow-graph.ts');
  const {createWorkflowRunner}=await import('./lib/workflow-runner.ts');
  const {createWorkflowRequestExecution}=await import('./lib/workflow-execution.ts');
  const schema={type:'array',items:{type:'object',properties:{name:{type:'string'},id:{type:'string'}},required:['name','id']}};
  const source={openapi:'3.1.0',info:{title:'File request',version:'1'},servers:[{url:'https://example.com'}],paths:{'/rows':{post:{operationId:'rows',requestBody:{required:true,content:{'application/json':{schema}}},responses:{200:{description:'Accepted'}}}}}};
  source.paths['/names']={post:{operationId:'names',requestBody:{required:true,content:{'application/json':{schema:{type:'array',items:{type:'string'}}}}},responses:{200:{description:'Accepted'}}}};
  const op=extractOperations(source,'file-fixture')[0];
  updateCatalogs([...catalogs,{id:'file-fixture',name:'Files',file:'file.json',document:source,groups:[],execution:{kind:'http',origin:'https://example.com'}}]);
  try {
    const graph=createOperationGraph(op,{x:0,y:0},'send',source);
    const input=graph.nodes.find(n=>n.type==='data'&&n.data.direction==='inputs');
    const file=parse('rows.csv','name;id\nAlice;00123');
    const doc={version:3,id:'csv-request',name:'CSV request',nodes:[...graph.nodes,{id:'file',type:'file',position:{x:0,y:0},data:{file}}],edges:[...graph.edges,{id:'csv-body',kind:'mapping',source:'file',sourceHandle:'value',target:input.id,targetHandle:input.data.fields[0].id}],viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false};
    let sent;
    const runner=createWorkflowRunner(doc,undefined,createWorkflowRequestExecution(async(_url,request)=>{sent=JSON.parse(request.body);return Response.json({ok:true});}));
    const visit=runner.next(); assert.equal(visit.kind,'operation');
    await runner.submit(visit.values);
    assert.deepEqual(sent,[{name:'Alice',id:'00123'}]);
    assert.equal(runner.next().kind,'complete');
    const {createFileDataGraph}=await import('./lib/workflow-graph.ts');
    const names=extractOperations(source,'file-fixture').find(op=>op.id==='file-fixture:names');
    const namesGraph=createOperationGraph(names,{x:0,y:0},'names',source);
    const namesInput=namesGraph.nodes.find(n=>n.type==='data'&&n.data.direction==='inputs');
    const owner={id:'file',type:'file',position:{x:0,y:0},data:{file}};
    const fields=createFileDataGraph(owner);
    const column=fields.nodes.find(n=>n.data.fields.some(f=>f.label==='name'));
    const columnField=column.data.fields.find(f=>f.label==='name');
    const columnDoc={...doc,nodes:[owner,...fields.nodes,...namesGraph.nodes],edges:[...fields.edges,...namesGraph.edges,
      {id:'column-body',kind:'mapping',source:column.id,sourceHandle:columnField.id,target:namesInput.id,targetHandle:namesInput.data.fields[0].id}]};
    const columnRunner=createWorkflowRunner(columnDoc,'names',createWorkflowRequestExecution(async(_url,request)=>{sent=JSON.parse(request.body);return Response.json({ok:true});}));
    await columnRunner.submit(columnRunner.next().values);
    assert.deepEqual(sent,['Alice']);

  } finally {updateCatalogs(catalogs);}
});

const fileOwner = value => ({id:'file',type:'file',position:{x:0,y:0},data:{file:parse('data.json',JSON.stringify(value))}});
const fileDocument = graph => ({version:3,id:'file-structures',name:'File structures',...graph,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false});
Then('uploaded structures project nested fields and CSV columns', async function () {
  const {createFileDataGraph}=await import('./lib/workflow-graph.ts');
  const {validateWorkflowDocument}=await import('./lib/workflow-document.ts');
  for (const value of [null,true,'text',3,3.5,{},[],[1,'mixed'],[{foo:1},{bar:true}],{items:'literal'}, {foo:{bar:{baz:'project-1'}}}]) {
    const owner=fileOwner(value), graph=createFileDataGraph(owner);
    validateWorkflowDocument(fileDocument({nodes:[owner,...graph.nodes],edges:graph.edges}));
    assert.ok(graph.nodes.every(n=>n.type==='data'&&n.data.ownerId==='file'&&n.data.direction==='outputs'));
  }
  assert.deepEqual(createFileDataGraph({...fileOwner(1),data:{}}),{nodes:[],edges:[]});
  const owner=fileOwner({foo:{bar:{baz:'project-1'}}});
  const graph=createFileDataGraph(owner);
  assert.deepEqual(graph.nodes.map(n=>n.data.fields.map(f=>[f.label,f.type])),[[['foo','Object']],[['bar','Object']],[['baz','Text']]]);
  const csv={...owner,data:{file:parse('rows.csv','foo,bar,baz,qux\n1,2,3,4\n5,6,7,8')}};
  const csvGraph=createFileDataGraph(csv);
  assert.deepEqual(csvGraph.nodes.map(n=>n.data.fields.map(f=>[f.label,f.type])),[[['Items','Array']],[['foo','Array'],['bar','Array'],['baz','Array'],['qux','Array']]]);
  const literal=createFileDataGraph(fileOwner({items:'hello'})); assert.equal(literal.nodes[0].data.fields[0].type,'Text');
  let deep={leaf:true}; for(let i=0;i<14;i++)deep={nested:deep};
  assert.ok(createFileDataGraph(fileOwner(deep)).nodes.some(n=>n.data.fields.some(f=>f.type==='Unknown')));
});
Then('replacing file structures preserves matching panels and removes invalid mappings', async function () {
  const {createFileDataGraph,updateFileDataGraph}=await import('./lib/workflow-graph.ts');
  const owner=fileOwner({foo:{bar:'one'},gone:{value:1}});
  const graph=createFileDataGraph(owner);
  const initial=updateFileDataGraph('file',owner.data,[{...owner,data:{}}],[]);
  assert.equal(initial.nodes.length,graph.nodes.length+1);
  const invalid=structuredClone(initial); invalid.nodes[1].data.direction='inputs';
  const {validateWorkflowDocument}=await import('./lib/workflow-document.ts');
  assert.throws(()=>validateWorkflowDocument(fileDocument(invalid)),/File panels/);
  const nodes=[owner,...graph.nodes]; graph.nodes[0].position={x:700,y:100}; graph.nodes[0].hidden=true;
  graph.edges[0].hidden=true;graph.edges[0].detached=true;
  const changed=updateFileDataGraph('file',fileOwner({foo:{bar:'two'},added:true}).data,nodes,graph.edges);
  assert.deepEqual(changed.nodes.find(n=>n.id===graph.nodes[0].id).position,{x:700,y:100});
  assert.equal(changed.nodes.find(n=>n.id===graph.nodes[0].id).hidden,true);
  assert.equal(changed.edges.find(e=>e.id===graph.edges[0].id).detached,true);
  assert.ok(!changed.nodes.some(n=>n.type==='data'&&n.data.label==='gone'));
  const unchanged=updateFileDataGraph('absent',owner.data,nodes,graph.edges);assert.equal(unchanged.nodes,nodes);
  const unrelated={id:'other',type:'comment',position:{x:0,y:0},data:{text:'Keep'}};
  const emptied=updateFileDataGraph('file',{},[...nodes,unrelated],graph.edges);
  assert.deepEqual(emptied.nodes.map(n=>n.id),['file','other']);assert.deepEqual(emptied.edges,[]);
});
Then('uploaded nested fields supply executable operation inputs', async function () {
  const {operations}=await import('./lib/catalog.ts');
  const {createOperationGraph,createFileDataGraph,updateFileDataGraph}=await import('./lib/workflow-graph.ts');
  const {parseWorkflowDocument}=await import('./lib/workflow-document.ts');
  const {createWorkflowRunner}=await import('./lib/workflow-runner.ts');
  const {createWorkflowDemo}=await import('./lib/workflow-demo.ts');
  const demo=(await import('./catalogs/demo.openapi.json',{with:{type:'json'}})).default;
  const operation=createOperationGraph(operations.find(op=>op.id==='demo:getProject'),{x:0,y:0},'get',demo);
  const owner=fileOwner({foo:{bar:{baz:'project-1'}}}),graph=createFileDataGraph(owner);
  const output=graph.nodes.find(n=>n.data.fields.some(f=>f.label==='baz'));
  const input=operation.nodes.find(n=>n.type==='data'&&n.data.direction==='inputs');
  const edge={id:'file-mapping',kind:'mapping',source:output.id,sourceHandle:output.data.fields[0].id,target:input.id,targetHandle:input.data.fields[0].id};
  const doc=fileDocument({nodes:[owner,...graph.nodes,...operation.nodes],edges:[...graph.edges,...operation.edges,edge]});
  for (const start of [undefined,'get']) {
    const runner=createWorkflowRunner(parseWorkflowDocument(JSON.stringify(doc)),start,createWorkflowDemo());
    const visit=runner.next();assert.equal(visit.kind,'operation');assert.equal(visit.values['path:projectId'],'project-1');
    await runner.submit(visit.values);assert.equal(runner.next().kind,'complete');
  }
  const unknown=fileOwner([1,'mixed']);
  const unknownGraph=createFileDataGraph(unknown);
  assert.equal(createWorkflowRunner(fileDocument({nodes:[unknown,...unknownGraph.nodes,...operation.nodes],edges:[...unknownGraph.edges,...operation.edges]}),undefined,createWorkflowDemo()).next().kind,'operation');
  const compatible=updateFileDataGraph('file',fileOwner({foo:{bar:{baz:'project-2'}}}).data,doc.nodes,doc.edges);
  assert.ok(compatible.edges.some(e=>e.id==='file-mapping'));
  const incompatible=updateFileDataGraph('file',fileOwner({foo:{bar:{baz:123}}}).data,doc.nodes,doc.edges);
  assert.ok(!incompatible.edges.some(e=>e.id==='file-mapping'));
  const removed=updateFileDataGraph('file',fileOwner({}).data,doc.nodes,doc.edges);
  assert.ok(!removed.edges.some(e=>e.id==='file-mapping'));
});
Then('array structures preserve item bounds and validate stored ranges', async function () {
  const {extractOperations}=await import('./lib/catalog.ts');
  const {createOperationGraph,createFileDataGraph}=await import('./lib/workflow-graph.ts');
  const {validateWorkflowDocument,parseWorkflowDocument}=await import('./lib/workflow-document.ts');
  for (const [constraints,expected] of [[{},{min:0}],[{maxItems:5},{min:0,max:5}],[{minItems:2,maxItems:5},{min:2,max:5}],
    [{minItems:-1,maxItems:-1},{min:0}],[{minItems:'x',maxItems:'x'},{min:0}],[{minItems:1.5,maxItems:1.5},{min:0}],
    [{minItems:2,maxItems:1},{min:2}]]) {
    const schema={type:'array',items:{type:'string'},...constraints};
    const source={openapi:'3.1.0',info:{title:'Ranges',version:'1'},paths:{'/range':{post:{operationId:'range',requestBody:{content:{'application/json':{schema}}},responses:{200:{description:'Range',content:{'application/json':{schema}}}}}}}};
    const graph=createOperationGraph({id:'ranges:range',name:'Range',description:'',method:'POST',path:'/range',group:'',fields:[],bodyRequired:false},{x:0,y:0},'range',source);
    const panels=graph.nodes.filter(n=>n.type==='data'&&n.data.array);
    assert.ok(panels.length>=2);
    for (const panel of panels) {assert.deepEqual(panel.data.array,expected);assert.deepEqual(panel.data.fields[0].array,expected);}
    const doc=parseWorkflowDocument(JSON.stringify(fileDocument(graph)));
    assert.deepEqual(doc.nodes.find(n=>n.type==='data'&&n.data.array).data.array,expected);
  }
  const owner=fileOwner(Array.from({length:25},(_,i)=>({foo:i})));
  const graph=createFileDataGraph(owner);
  assert.deepEqual(graph.nodes[0].data.array,{min:0,max:25});
  for (const panel of graph.nodes) for(const field of panel.data.fields)assert.deepEqual(field.array,{min:0,max:25});
  const doc=fileDocument({nodes:[owner,...graph.nodes],edges:graph.edges});
  for(const bounds of [null,{}, {min:-1},{min:1.5},{min:'2'},{min:2,max:1},{min:0,max:-1},{min:0,max:1.5},{min:0,max:'5'}]) {
    const invalid=structuredClone(doc);invalid.nodes[1].data.array=bounds;assert.throws(()=>validateWorkflowDocument(invalid));
    const invalidField=structuredClone(doc);invalidField.nodes[1].data.fields[0].array=bounds;assert.throws(()=>validateWorkflowDocument(invalidField));
  }
});
