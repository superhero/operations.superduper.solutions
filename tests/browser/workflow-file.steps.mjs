// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { workflow, readExport, setMode, chooseCatalogOperation, quitRun } from './workspace.steps.mjs';
import { gesture } from './workflow-single-input.steps.mjs';
Then('I can upload typed workflow files and correct CSV detection', async function () {
  const page=this.page;
  await page.getByRole('button',{name:'Add file',exact:true}).click();
  const node=workflow(page).locator('.svelte-flow__node-file');
  const upload=async(name,text)=>node.locator('input[type=file]').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(text)});
  await upload('project.json','"project-1"');
  await expect(node.locator('.utility-type')).toHaveText('Text');
  await page.getByRole('button',{name:'Fit View',exact:true}).click();
  await gesture(page,node.getByLabel('File output (Text)',{exact:true}),workflow(page).getByLabel('Path value input',{exact:true}),'drag');
  assert.equal((await readExport(page)).document.edges.filter(e=>e.kind==='mapping').length,1);
  await upload('bad.json','{');
  await expect(node.getByRole('alert')).toBeVisible();
  await expect(node.locator('.utility-type')).toHaveText('Text');
  await upload('rows.csv','name;id\nAlice;00123\nBob;00234');
  await expect(node.locator('.utility-type')).toHaveText('Array');
  await expect(node.getByRole('alert')).toHaveCount(0);
  let doc=(await readExport(page)).document;
  assert.deepEqual(doc.nodes.find(n=>n.type==='file').data.file.value,[{name:'Alice',id:123},{name:'Bob',id:234}]);
  assert.equal(doc.edges.filter(e=>e.kind==='mapping').length,0);
  await node.getByRole('combobox',{name:'CSV header',exact:true}).click();
  await page.getByRole('option',{name:'No header',exact:true}).click();
  await expect(node.getByRole('combobox',{name:'CSV header',exact:true})).toContainText('No header');
  doc=(await readExport(page)).document;
  assert.deepEqual(doc.nodes.find(n=>n.type==='file').data.file.value,[['name','id'],['Alice','00123'],['Bob','00234']]);
  await expect(page.locator(".site-header .document-meta").getByText("Saved locally", {exact:true})).toBeVisible();
  await page.reload();
  await page.locator('#startup-status').waitFor({state:'detached'});
  await expect(node.getByRole('combobox',{name:'CSV header',exact:true})).toContainText('No header');
  assert.deepEqual((await readExport(page)).document.nodes.find(n=>n.type==='file').data.file.value,doc.nodes.find(n=>n.type==='file').data.file.value);
  const before = (await readExport(page)).document.nodes.find(n=>n.type==='file').data.file.original;
  await node.getByRole('combobox',{name:'CSV quotes',exact:true}).click();
  await page.getByRole('option',{name:'None',exact:true}).click();
  await expect(node.getByRole('combobox',{name:'CSV quotes',exact:true})).toContainText('None');
  assert.deepEqual((await readExport(page)).document.nodes.find(n=>n.type==='file').data.file.original,before);
});
Then('file previews limit visible rows and load additional lines on demand', async function () {
  const page=this.page;
  await page.getByRole('button',{name:'Add file',exact:true}).click();
  const node=workflow(page).locator('.svelte-flow__node-file');
  const upload=async values=>node.locator('input[type=file]').setInputFiles({name:'rows.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(values))});
  await upload(Array.from({length:1100},(_,i)=>i));
  await expect(node.locator('.utility-type')).toHaveText('Array');
  await node.locator('.schema-disclosure > summary').click();
  const scroll=node.locator('.json-scroll');
  await expect(scroll).toBeVisible();
  const dimensions=await scroll.evaluate(el=>({height:el.getBoundingClientRect().height,scroll:el.scrollHeight}));
  assert.ok(dimensions.height<=384.5 && dimensions.scroll>dimensions.height);
  await expect(node.getByRole('button',{name:'Load more',exact:true})).toBeVisible();
  assert.ok(await node.locator('.json-line').count()<=1000);
  await expect(node.locator('.json-number').filter({hasText:/^1099$/})).toHaveCount(0);
  // Opening the preview grows the canvas node beyond the current viewport.
  // Bring it back into view through the real camera control before clicking.
  await page.getByRole('button',{name:'Fit View',exact:true}).click();
  const panel=node.locator('.schema-disclosure > .disclosure-panel');
  await expect.poll(()=>panel.evaluate(element=>Math.abs(element.clientHeight-element.firstElementChild.offsetHeight))).toBeLessThanOrEqual(1);
  await node.getByRole('button',{name:'Load more',exact:true}).click();
  await expect(node.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
  await expect(node.locator('.json-number').filter({hasText:/^1099$/})).toHaveCount(1);
  await upload([1,2,3]);
  await expect(node.locator('.json-number')).toHaveCount(3);
  await expect(node.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
  await upload({reference:{$ref:'#/target'},target:{value:'File reference destination'}});
  const destination=node.getByRole('group',{name:'File data: $["target"]',exact:true}).locator(':scope > summary');
  await destination.click();
  await expect(destination).toHaveAttribute('aria-expanded','false');
  await node.getByRole('button',{name:'Go to #/target',exact:true}).click();
  await expect(destination).toHaveAttribute('aria-expanded','true');
  await expect(destination).toBeFocused();
  await expect(destination).toBeInViewport({ratio:1});
});
Then('uploaded files create nested output panels and preserve compatible field connections', async function () {
  const page=this.page;
  await page.getByRole('button',{name:'Add file',exact:true}).click();
  const node=workflow(page).locator('.svelte-flow__node-file');
  const upload=async(name,value)=>node.locator('input[type=file]').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(value)});
  await upload('nested.json',JSON.stringify({foo:{bar:{baz:'project-1'}}}));
  await expect(node.locator('.utility-type')).toHaveText('Object');
  const owner=await node.getAttribute('data-id');
  const panels=workflow(page).locator(`.workflow-data-node[data-owner-id="${owner}"]`);
  await expect(panels).toHaveCount(3);
  await expect(node.locator('.svelte-flow__handle')).toHaveCount(1);
  await expect(node.getByText('Data structure',{exact:true})).toHaveCount(0);
  const structure=(await readExport(page)).document.edges.find(e=>e.kind==='schema'&&e.source===owner);
  assert.equal(structure.sourceHandle,'value');
  await page.getByRole('button',{name:'Fit View',exact:true}).click();
  await gesture(page,panels.getByLabel('baz output',{exact:true}),workflow(page).getByLabel('Path value input',{exact:true}),'drag');
  let doc=(await readExport(page)).document;
  assert.equal(doc.edges.filter(e=>e.kind==='mapping').length,1);
  await upload('nested.json',JSON.stringify({foo:{bar:{baz:'project-2'}}}));
  await expect.poll(async()=>(await readExport(page)).document.nodes.find(n=>n.type==='file').data.file.value.foo.bar.baz).toBe('project-2');
  assert.equal((await readExport(page)).document.edges.filter(e=>e.kind==='mapping').length,1);
  await upload('rows.csv',['foo,bar,baz,qux',...Array.from({length:25},(_,i)=>`${i},${i+1},${i+2},${i+3}`)].join('\n'));
  await expect(panels.locator('.data-title .material-symbols-rounded').filter({hasText:'data_array'})).toHaveCount(1);
  await expect(panels).toHaveCount(2);
  await expect(panels.locator('.field-name').first()).toHaveText('0..25');
  await expect(panels.locator('.field-type')).toHaveText(['Object','Integer','Integer','Integer','Integer']);
  doc=(await readExport(page)).document;
  assert.equal(doc.edges.filter(e=>e.kind==='mapping').length,0);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally',{exact:true})).toBeVisible();
  await page.reload();await page.locator('#startup-status').waitFor({state:'detached'});
  await expect(panels).toHaveCount(2);
});
Then('CSV Item connections send correlated scalar requests for every row', async function () {
  const page=this.page;const requests=[];
  await page.route('https://example.com/**',async route=>{requests.push(route.request().url());await route.fallback();});
  await page.getByRole('button',{name:'Add file',exact:true}).click();
  const file=workflow(page).locator('.svelte-flow__node-file');
  await file.locator('input[type=file]').setInputFiles({name:'requests.csv',mimeType:'text/csv',buffer:Buffer.from('name,limit\nDocumentation,1\nWebsite,2')});
  const owner=await file.getAttribute('data-id');
  const panels=workflow(page).locator(`.workflow-data-node[data-owner-id="${owner}"]`);
  await expect(panels).toHaveCount(2);
  await expect(panels.locator('.field-type')).toHaveText(['Object','Text','Integer']);
  await page.getByRole('button',{name:'Fit View',exact:true}).click();
  await gesture(page,panels.getByLabel('name output',{exact:true}),workflow(page).getByLabel('Name input',{exact:true}),'drag');
  await gesture(page,panels.getByLabel('limit output',{exact:true}),workflow(page).getByLabel('Result limit input',{exact:true}),'drag');
  assert.equal((await readExport(page)).document.edges.filter(e=>e.kind==='mapping').length,2);
  await page.getByRole('button',{name:'Run workflow',exact:true}).click();
  const run=page.getByRole('dialog',{name:/^Run workflow:/});
  for (const [index,name] of ['Documentation','Website'].entries()) {
    await expect(run.getByRole('heading',{name:`${index+1}. Example array response`,exact:true})).toBeVisible();
    await expect(run.getByRole('textbox',{name:'Name',exact:true})).toHaveValue(name);
    await expect(run.getByRole('textbox',{name:'Result limit value',exact:true})).toHaveValue(String(index+1));
    await run.getByRole('button',{name:index?'Run operation':'Start workflow',exact:true}).click();
    await expect(run.getByRole('region',{name:`Step ${index+1} response`,exact:true})).toBeVisible();
    await run.getByRole('button',{name:'Next operation',exact:true}).click();
  }
  await expect(run.getByRole('heading',{name:'Workflow complete.',exact:true})).toBeVisible();
  assert.deepEqual(requests.map(url=>Object.fromEntries(new URL(url).searchParams)),[{name:'Documentation',limit:'1'},{name:'Website',limit:'2'}]);
});

Then('file nodes send original bytes through {string} inputs after reload', async function (transport) {
  const page = this.page;
  const original = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const fileSchema = { type: 'string', format: 'binary', title: 'Attachment' };
  const schema = transport === 'multipart/form-data'
    ? { type: 'object', required: ['attachment'], properties: { attachment: fileSchema } } : fileSchema;
  const source = { openapi: '3.1.0', info: { title: 'Binary upload browser fixture', version: '1' }, servers: [{ url: this.baseURL }],
    paths: { '/binary-file-upload': { post: { operationId: 'binary-upload', summary: 'Upload binary fixture',
      requestBody: { required: true, content: { [transport]: { schema } } }, responses: { 200: { description: 'Accepted' } } } } } };
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type=file][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'binary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('switch', { name: 'Enable Binary upload browser fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, 'Upload binary fixture');
  // File inputs are real file controls when not connected.
  await expect(page.getByRole('dialog', { name: /^Run workflow:/ }).getByLabel('Attachment', { exact: true })).toHaveAttribute('type', 'file');
  await quitRun(page);
  await page.getByRole('button', { name: 'Add file', exact: true }).click();
  const file = workflow(page).locator('.svelte-flow__node-file');
  const picker = file.getByLabel('Upload workflow data file', { exact: true });
  await picker.setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(file.locator('.utility-type')).toHaveText('Binary');
  await expect(file.locator('.file-name')).toHaveText('sample.pdf');
  await expect(file.locator('.file-summary')).toHaveText('application/pdf · 256 bytes');
  await expect(file.locator('.svelte-flow__handle')).toHaveCount(1);
  await expect(file.locator('.schema-disclosure')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await gesture(page, file.getByLabel('File output (Binary)', { exact: true }), workflow(page).getByLabel('Attachment input', { exact: true }), 'drag');
  let saved = (await readExport(page)).document;
  assert.equal(saved.edges.filter(edge => edge.kind === 'mapping').length, 2);
  const cast = workflow(page).locator('.svelte-flow__node-cast');
  await expect(cast).toHaveCount(1);
  await expect(cast.getByRole('combobox', { name: 'Cast output type', exact: true })).toContainText('Binary');
  assert.equal(saved.nodes.filter(node => node.type === 'data' && node.data.ownerId === saved.nodes.find(n => n.type === 'file').id).length, 0);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(file.locator('.file-summary')).toHaveText('application/pdf · 256 bytes');
  assert.equal((await readExport(page)).document.edges.filter(edge => edge.kind === 'mapping').length, 2);
  await expect(cast.getByRole('combobox', { name: 'Cast output type', exact: true })).toContainText('Binary');
  const requests = [];
  await page.route('**/binary-file-upload', async route => {
    const request = route.request();
    const raw = request.postDataBuffer();
    if (transport === 'multipart/form-data') {
      const form = await new Request(request.url(), { method: request.method(), headers: request.headers(), body: raw }).formData();
      const attachment = form.get('attachment');
      requests.push({ bytes: Buffer.from(await attachment.arrayBuffer()), name: attachment.name, type: attachment.type });
    } else requests.push({ bytes: raw, type: request.headers()['content-type'] });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
  });
  async function send(expectedBytes, expectedName, expectedType) {
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    const run = page.getByRole('dialog', { name: /^Run workflow:/ });
    const connected = run.getByLabel('Attachment', { exact: true });
    await expect(connected).toBeDisabled();
    await expect(connected).toHaveValue(expectedName);
    await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
    await expect(run.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('true');
    const request = requests.at(-1);
    assert.deepEqual(request.bytes, expectedBytes);
    assert.equal(request.type, expectedType);
    if (transport === 'multipart/form-data') assert.equal(request.name, expectedName);
    await quitRun(page);
  }
  await send(original, 'sample.pdf', 'application/pdf');
  // JSON retains its object and schema panels while the very same handle still
  // sends original JSON bytes to this binary destination without a mode switch.
  const json = Buffer.from(' { "number": 12 }\n');
  await picker.setInputFiles({ name: 'numbers.json', mimeType: 'application/json', buffer: json });
  await expect(file.locator('.utility-type')).toHaveText('Object');
  const owner = await file.getAttribute('data-id');
  await expect(workflow(page).locator(`.workflow-data-node[data-owner-id="${owner}"]`)).toHaveCount(1);
  saved = (await readExport(page)).document;
  assert.deepEqual(saved.nodes.find(n => n.type === 'file').data.file.value, { number: 12 });
  assert.equal(saved.edges.filter(edge => edge.kind === 'mapping').length, 2);
  await expect(file.locator('.svelte-flow__handle')).toHaveCount(1);
  await send(json, 'numbers.json', 'application/json');
});
