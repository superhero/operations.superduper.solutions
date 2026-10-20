// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

/** Observe an actual toggle click without putting automation calls between frames. */
export async function captureRevisionClose(panel, toggle) {
  await toggle.scrollIntoViewIfNeeded();
  await toggle.focus();
  await panel.evaluate(element => {
    const button = element.previousElementSibling;
    const scrollers = [];
    for (let node = element.parentElement; node; node = node.parentElement)
      if (node.scrollHeight > node.clientHeight || node === document.scrollingElement) scrollers.push(node);
    const snapshot = () => ({ height: element.getBoundingClientRect().height,
      rows: element.querySelectorAll('[data-version-oid]').length,
      headerTop: button.getBoundingClientRect().top,
      scrollTop: scrollers.map(node => ({ tag: node.tagName, top: node.scrollTop })) });
    const before = snapshot();
    element.__revisionClose = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (button.getAttribute('aria-expanded') !== 'false') return;
        observer.disconnect();
        const start = performance.now();
        const frames = [];
        const immediate = snapshot();
        const frame = () => {
          frames.push({ ms: performance.now() - start, ...snapshot() });
          if ((element.hidden && frames.at(-1).height < 1) || performance.now() - start > 1000)
            resolve({ before, immediate, frames });
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
    });
  });
  await toggle.click();
  return panel.evaluate(async element => {
    const result = await element.__revisionClose;
    delete element.__revisionClose;
    return result;
  });
}

/** A short Chrome rendering trace, separate from the three frame observations. */
export async function traceRevisionClose(context, page, path, action) {
  const session = await context.newCDPSession(page);
  const events = [];
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const completed = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
  let recording = false;
  try {
    await session.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: {
      includedCategories: ['devtools.timeline', 'blink.user_timing'], recordMode: 'recordUntilFull', traceBufferSizeInKb: 4096,
    } });
    recording = true;
    await page.evaluate(() => performance.mark('revision-collapse-start'));
    const result = await action();
    await page.evaluate(() => performance.mark('revision-collapse-end'));
    await session.send('Tracing.end'); recording = false;
    assert.notEqual((await completed).dataLossOccurred, true);
    const text = JSON.stringify({ traceEvents: events });
    assert.ok(text.length < 8 * 1024 * 1024, 'Keep the rendering trace bounded.');
    await writeFile(path, text);
    return { result, bytes: text.length, events: events.length };
  } finally {
    if (recording) { await session.send('Tracing.end').catch(() => {}); await completed; }
    await session.detach();
  }
}
