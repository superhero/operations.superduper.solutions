// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import {chromium} from '@playwright/test';
assert.equal(process.env.OPERATIONS_TEST_RESOURCE_PROFILE,'ci','Run in the bounded browser QA profile.');
const read=async name=>(await readFile('/sys/fs/cgroup/'+name,'utf8')).trim();
const cpu=(await read('cpu.max')).split(' ').map(Number);assert.equal(cpu[0]/cpu[1],4);
assert.equal(await read('memory.max'),'4294967296');assert.equal(await read('memory.swap.max'),'0');assert.equal(await read('pids.max'),'512');
const directory=resolve('tmp/test/multipart-files-ui');await mkdir(directory,{recursive:true});
const report={passed:[],pageErrors:[],externalRequests:[]};let server,browser;
try {
 server=await createServer({configFile:false,root:process.cwd(),logLevel:'error',cacheDir:directory+'/.vite',plugins:[svelte({configFile:false})],
   resolve:{alias:{$lib:resolve('src/lib')}},optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0,watch:null}});
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(origin+'/'))await route.continue();else{report.externalRequests.push(url);await route.abort();}});
 const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));await page.goto(origin+'/tests/multipart-files/index.html');
 await page.waitForFunction(()=>!!window.multipartFilesFixture);const picker=page.getByLabel('Files',{exact:true});assert.notEqual(await picker.getAttribute('multiple'),null);
 const files=[{name:'one.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,128])},{name:'two.txt',mimeType:'text/plain',buffer:Buffer.from('λ\r\nβ')}];
 await picker.setInputFiles(files);await page.waitForFunction(()=>window.multipartFilesFixture.read().emissions===1);const first=await page.evaluate(()=>window.multipartFilesFixture.read());
 const values=JSON.parse(first.value);assert.deepEqual(values.map(x=>x.name),files.map(x=>x.name));for(const [index,value]of values.entries())assert.deepEqual(Buffer.from(value.base64,'base64'),files[index].buffer);report.passed.push('multiple files preserve order names and bytes');
 await picker.setInputFiles([...files,files[0]]);await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/number/);assert.deepEqual(await page.evaluate(()=>window.multipartFilesFixture.read()),first);report.passed.push('item count failure preserves prior selection');
 await picker.setInputFiles([{name:'large.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(500001)}]);await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('500 kB'));assert.deepEqual(await page.evaluate(()=>window.multipartFilesFixture.read()),first);report.passed.push('byte limit failure preserves prior selection');
 await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){window.fileReadStarted=true;await new Promise(resolve=>window.releaseFileRead=resolve);const bytes=await original.call(this);window.fileReadFinished=true;return bytes;};});
 await picker.setInputFiles([files[0]]);await page.waitForFunction(()=>window.fileReadStarted);await page.evaluate(()=>{window.multipartFilesFixture.deactivate();window.releaseFileRead();});await page.waitForFunction(()=>window.fileReadFinished);
 assert.deepEqual(await page.evaluate(()=>window.multipartFilesFixture.read()),first);report.passed.push('inactive control discards pending upload');
 await page.evaluate(()=>window.multipartFilesFixture.disable());await page.waitForFunction(()=>document.querySelector('input').disabled);assert.deepEqual(await page.evaluate(()=>window.multipartFilesFixture.read()),first);assert.equal(await page.getByLabel('Files',{exact:true}).inputValue(),'one.bin, two.txt');report.passed.push('disabled control keeps persisted file names');
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.externalRequests,[]);
} catch(error){report.error=String(error?.stack??error);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(directory+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
