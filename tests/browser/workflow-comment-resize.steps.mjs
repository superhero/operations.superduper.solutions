// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { workflow, readExport } from './workspace.fixture.mjs';
Then('I can resize a comment from its sides and corners and retain its size', async function () {
  const page=this.page;
  await page.getByRole('button',{name:'Comment',exact:true}).click();
  const node=workflow(page).locator('.svelte-flow__node-comment');
  await expect(node.locator('textarea')).toHaveCount(0);
  await expect(node.getByRole('textbox', { name: 'Comment text (Markdown)', exact: true })).toBeVisible();
  await expect(node.locator('.comment-resize-handle')).toHaveCount(8);
  for (const [side,dx,dy] of [['right',60,0],['bottom-right',30,40]]) {
    const handle=node.getByLabel(`Resize comment ${side}`,{exact:true});
    const before=await node.boundingBox(); const box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down(); await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:8}); await page.mouse.up();
    await expect.poll(async()=>(await node.boundingBox()).width).toBeGreaterThan(before.width+20);
  }
  const data=(await readExport(page)).document.nodes.find(n=>n.type==='comment').data;
  assert.ok(data.width>300 && data.height>180);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally',{exact:true})).toBeVisible();
  await page.reload(); await page.locator('#startup-status').waitFor({state:'detached'});
  assert.deepEqual((await readExport(page)).document.nodes.find(n=>n.type==='comment').data,data);
});
