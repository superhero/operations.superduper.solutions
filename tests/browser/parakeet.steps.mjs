// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { installSpeechFixture } from './parakeet.fixture.mjs';
import { setMode } from './workspace.fixture.mjs';
import { wav } from '../../src/lib/speech/diagnostics.js';
import { readFile } from 'node:fs/promises';
import { installAssistantFixture } from './browser-assistant.fixture.mjs';

async function open(page, fixture = true) {
  if (fixture) await installSpeechFixture(page);
  await setMode(page, 'settings');
  const summary = page.locator('summary[aria-label="Assistant"]');
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  const speech = page.locator('.speech-settings');
  if (!(await speech.getAttribute('open') === '')) await speech.locator(':scope > summary').click();
  return speech;
}
const draft = page => page.getByRole('textbox', { name: 'Message', exact: true });
const button = (speech, name) => speech.getByRole('button', { name, exact: true });
async function load(speech) { await button(speech, 'Load speech').click(); await expect(button(speech, 'Dictate')).toBeEnabled(); }
async function start(page, speech) {
  await button(speech, 'Dictate').click(); await expect(button(speech, 'Stop dictation')).toBeVisible();
  const transport = await page.evaluate(async () => ({ url: window.speechFixture.featureUrl, status: (await fetch(window.speechFixture.featureUrl)).status, error: window.speechFixture.featureError }));
  expect(transport.status, JSON.stringify(transport)).toBe(200);
  expect(transport.error, JSON.stringify(transport)).toBeUndefined();
  await page.evaluate(() => window.speechFixture.pcm());
}

Then('Parakeet and Bonsai share the draft without sending during capture', async function() {
  const page = this.page;
  await installAssistantFixture(page); await installSpeechFixture(page);
  const speech = await open(page, false), panel = page.getByRole('region', { name: 'Browser assistant', exact: true });
  await page.evaluate(() => window.assistantFixture.behavior = 'manual');
  await panel.getByRole('button', { name: 'Load model', exact: true }).click(); await load(speech);
  await draft(page).fill('Typed introduction.'); await start(page, speech);
  await page.evaluate(() => window.speechFixture.partial('First sentence.', 'Unconfirmed words'));
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await draft(page).press('Enter'); expect(await page.evaluate(() => window.assistantFixture.lastMessage)).toBeUndefined();
  await button(speech, 'Stop dictation').click();
  await expect(draft(page)).toHaveValue('Typed introduction. First sentence. Second sentence.');
  expect(await page.evaluate(() => window.assistantFixture.lastMessage)).toBeUndefined();
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.assistantFixture.lastMessage?.text)).toBe('Typed introduction. First sentence. Second sentence.');
  expect(await page.evaluate(() => window.assistantFixture.calls)).toEqual([]);
  await page.evaluate(() => window.assistantFixture.emit({ type: 'done' }));
});

Then('Parakeet dictation appends confirmed text and saves local audio across recordings', async function() {
  const page = this.page, requests = []; page.on('request', request => { if (/huggingface|jsdelivr/.test(request.url())) requests.push(request.url()); });
  const speech = await open(page); expect(await page.evaluate(() => window.speechFixture.workers)).toBe(0);
  await load(speech); await draft(page).fill('Typed introduction.');
  await start(page, speech); await page.evaluate(() => window.speechFixture.partial('First sentence.', 'Still provisional'));
  await expect(draft(page)).toHaveValue('Typed introduction. First sentence.');
  await expect(speech.getByLabel('Provisional transcript')).toHaveText('Still provisional');
  await draft(page).fill('Edited introduction. First sentence.');
  await button(speech, 'Stop dictation').click();
  await expect(draft(page)).toHaveValue('Edited introduction. First sentence. Second sentence.');
  await start(page, speech); await page.evaluate(() => { window.speechFixture.finalText = 'Another recording.'; });
  await button(speech, 'Stop dictation').click();
  await expect(draft(page)).toHaveValue('Edited introduction. First sentence. Second sentence. Another recording.');
  const evidence = await page.evaluate(async () => {
    const request = indexedDB.open('v1/speech/recordings'); const db = await new Promise(resolve => request.onsuccess = () => resolve(request.result));
    const get = db.transaction('sessions').objectStore('sessions').getAll(); const values = await new Promise(resolve => get.onsuccess = () => resolve(get.result)); db.close();
    return values.map(value => ({ status: value.status, size: value.audio.size, samples: value.signal.samples }));
  });
  expect(evidence).toHaveLength(2); expect(evidence.every(value => value.status === 'complete' && value.size === 16044 && value.samples === 4000)).toBe(true);
  expect(await page.evaluate(() => window.speechFixture.stoppedTracks)).toBe(2);
  await expect(page.getByRole('log')).not.toContainText('Another recording.'); expect(requests).toEqual([]);
});

Then('Parakeet silence leaves the draft unchanged and pane closure stops capture', async function() {
  const page = this.page, speech = await open(page); await load(speech); await draft(page).fill('Keep my draft');
  await page.evaluate(() => window.speechFixture.finalText = ''); await start(page, speech);
  await page.locator('summary[aria-label="Assistant"]').click();
  await expect.poll(() => page.evaluate(() => window.speechFixture.stoppedTracks)).toBe(1);
  await page.locator('summary[aria-label="Assistant"]').click(); await expect(draft(page)).toHaveValue('Keep my draft');
  await expect(speech.getByRole('status')).toContainText('No speech detected');
  await expect(button(speech, 'Dictate')).toBeEnabled(); expect(await page.evaluate(() => window.speechFixture.terminated)).toBe(0);
});

Then('Parakeet microphone failures allow retry without leaking late streams', async function() {
  const page = this.page, speech = await open(page); await load(speech);
  await page.evaluate(() => window.speechFixture.permission = 'deny'); await button(speech, 'Dictate').click();
  await expect(speech.getByRole('alert')).toContainText('permission denied'); await expect(button(speech, 'Dictate')).toBeEnabled();
  await page.evaluate(() => window.speechFixture.permission = 'pending'); await button(speech, 'Dictate').click();
  await button(speech, 'Cancel microphone').click(); await page.evaluate(() => window.speechFixture.grant());
  await expect.poll(() => page.evaluate(() => window.speechFixture.stoppedTracks)).toBe(1);
  await page.evaluate(() => window.speechFixture.permission = 'allow'); await start(page, speech);
  await button(speech, 'Unload speech').click(); await expect.poll(() => page.evaluate(() => window.speechFixture.stoppedTracks)).toBe(2);
  await expect(button(speech, 'Load speech')).toBeEnabled();
});

Then('Parakeet restores loaded speech after reload and unload clears restoration', async function() {
  const page = this.page; let speech = await open(page);
  await speech.getByRole('combobox', { name: 'Speech runtime', exact: true }).click();
  await page.getByRole('option', { name: 'WebGPU · FP32 encoder', exact: true }).click(); await load(speech);
  await page.reload(); speech = await open(page, false); await expect(button(speech, 'Dictate')).toBeEnabled();
  expect(await page.evaluate(() => window.speechFixture.mode)).toBe('gpu-fp32'); expect(await page.evaluate(() => window.speechFixture.nodes.length)).toBe(0);
  await button(speech, 'Unload speech').click(); await page.reload(); speech = await open(page, false);
  await expect(button(speech, 'Load speech')).toBeEnabled(); expect(await page.evaluate(() => window.speechFixture.workers)).toBe(0);
});

Then('Parakeet initialization deadline terminates the old worker before Retry', async function() {
  const page = this.page; await installSpeechFixture(page, { slow: true }); const speech = await open(page, false);
  await page.clock.install(); await button(speech, 'Load speech').click(); await expect(speech.getByRole('status')).toContainText('Creating encoder');
  await page.clock.fastForward(120001); await expect(speech.getByRole('alert')).toContainText('120 seconds');
  expect(await page.evaluate(() => window.speechFixture.terminated)).toBe(1);
  await page.evaluate(() => window.speechFixture.slow = false); await button(speech, 'Retry speech').click();
  await expect(button(speech, 'Dictate')).toBeEnabled(); expect(await page.evaluate(() => window.speechFixture.workers)).toBe(2);
});

Then('Parakeet transcribes files and exports evidence without overflowing Settings', async function() {
  const page = this.page; await page.setViewportSize({ width: 390, height: 844 }); const speech = await open(page); await load(speech);
  const file = { name: 'sample.wav', mimeType: 'audio/wav', buffer: Buffer.from(await wav([new Float32Array(16000)]).arrayBuffer()) };
  await speech.getByLabel('Transcribe audio file').setInputFiles(file); await expect(draft(page)).toHaveValue('From an audio file.');
  await speech.locator('summary').filter({ hasText: /^Local speech diagnostics/ }).click();
  await expect(speech.getByLabel('Saved speech recording', { exact: true })).toBeVisible();
  await speech.getByLabel('What you said (optional)', { exact: true }).fill('From a file.'); await speech.getByLabel('What you said (optional)', { exact: true }).blur();
  await expect(speech).toContainText('word error rate');
  const download = page.waitForEvent('download'); await button(speech, 'Export recording and diagnostics').click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/^parakeet-debug-.*\.json$/);
  const report = JSON.parse(await readFile(await exported.path(), 'utf8'));
  expect(report.final.text).toBe('From an audio file.'); expect(report.metadata.source).toBe('file');
  expect(report.audio.sampleRate).toBe(16000); expect(report.comparison.referenceWords).toBe(3);
  const audio = Buffer.from(report.audio.dataUrl.split(',')[1], 'base64');
  expect(audio.length).toBe(64044); expect(audio.readUInt16LE(20)).toBe(3);
  expect(await speech.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await this.attach(await speech.screenshot({ timeout: 5000 }), 'image/png');
  await button(speech, 'Delete saved recordings').click(); await expect(speech).toContainText('No saved recordings.');
});
