// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run with matching Playwright Chromium: node tests/metrics-history-repository.smoke.mjs

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { pail } from "@visulima/pail";

const fixtureId = "virtual:metrics-history-test";
const server = await createServer({ configFile: false, root: resolve("src"),
  cacheDir: resolve("tmp/test/metrics-history/.vite"),
  optimizeDeps: { include: ["@isomorphic-git/lightning-fs", "isomorphic-git", "buffer"] },
  server: { host: "127.0.0.1", port: 0, strictPort: true },
  plugins: [{ name: "metrics-history-test-fixture",
    resolveId(id) { if (id === fixtureId) return `\0${fixtureId}`; },
    load(id) { if (id === `\0${fixtureId}`) return `
      export { default as LightningFS } from '@isomorphic-git/lightning-fs';
      export * as git from 'isomorphic-git';
      export { createMetricsHistoryRepository } from '/lib/metrics-history-repository.ts';
    `; },
  }],
});

const duration = 15 * 60_000;
const start = Date.UTC(2026, 0, 1);
const bar = (index, value) => ({ start: start + index * duration, end: start + (index + 1) * duration,
  metrics: { usage: { open: value, high: value + 4, low: value - 2, close: value + 1, count: 3 } } });
const bars = [bar(0, 10), bar(1, 20), bar(2, 30), bar(3, 40)];
const name = "metrics-history-smoke";
const failures = [];
let browser;

async function openPage(context, baseURL) {
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(`${baseURL}/__metrics-test`);
  await page.evaluate(async ({ fixtureId, name }) => {
    globalThis.fixture = await import(`/@id/${fixtureId}`);
    globalThis.repository = fixture.createMetricsHistoryRepository({ filesystemName: name });
    globalThis.inspectFS = new fixture.LightningFS(name);
  }, { fixtureId, name });
  return page;
}

async function inspect(page) {
  return page.evaluate(async () => {
    const fs = inspectFS;
    const commits = await fixture.git.log({ fs, dir: "/metrics" });
    const history = [];
    for (const commit of commits) {
      const files = await fixture.git.listFiles({ fs, dir: "/metrics", ref: commit.oid });
      const values = [];
      for (const filepath of files) {
        const { blob } = await fixture.git.readBlob({ fs, dir: "/metrics", oid: commit.oid, filepath });
        values.push(JSON.parse(new TextDecoder().decode(blob)));
      }
      history.push({ files, values });
    }
    let journal = false;
    try { await fs.promises.stat("/metrics/.git/metrics-pending.json"); journal = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return { history, journal, status: await fixture.git.statusMatrix({ fs, dir: "/metrics" }) };
  });
}

try {
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: "/usr/bin/brave-browser" });
  const context = await browser.newContext();
  await context.route(`${baseURL}/__metrics-test`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Metrics history test</title>" }));
  const page = await openPage(context, baseURL);
  assert.deepEqual(await page.evaluate(() => repository.load()), []);

  // Interrupted after the durable journal, before writing or staging the bar.
  await page.evaluate(async first => {
    await inspectFS.promises.writeFile("/metrics/.git/metrics-pending.json", JSON.stringify(first), "utf8");
    await inspectFS.promises.flush();
  }, bars[0]);
  assert.deepEqual(await page.evaluate(() => repository.load()), [bars[0]]);
  let stored = await inspect(page);
  assert.equal(stored.history.length, 1);
  assert.equal(stored.journal, false);

  // Interrupted after staging a completed file; startup must recover it exactly once.
  await page.evaluate(async ({ second, name }) => {
    const path = "/metrics/bars/2026/01/01/00-15.json";
    await inspectFS.promises.writeFile(path, JSON.stringify(second), "utf8");
    await fixture.git.add({ fs: inspectFS, dir: "/metrics", filepath: path.slice("/metrics/".length) });
    await inspectFS.promises.flush();
    globalThis.repository = fixture.createMetricsHistoryRepository({ filesystemName: name });
  }, { second: bars[1], name });
  assert.deepEqual(await page.evaluate(() => repository.load()), bars.slice(0, 2));
  stored = await inspect(page);
  assert.equal(stored.history.length, 2);

  // A committed bar with an uncleared journal and ordinary duplicate saves stay idempotent.
  await page.evaluate(async second => {
    await inspectFS.promises.writeFile("/metrics/.git/metrics-pending.json", JSON.stringify(second), "utf8");
    await inspectFS.promises.flush();
    await repository.save([second]);
  }, bars[1]);
  await page.evaluate(first => repository.save([first, first]), bars[0]);
  stored = await inspect(page);
  assert.equal(stored.history.length, 2);
  assert.equal(stored.journal, false);

  const conflict = structuredClone(bars[0]);
  conflict.metrics.usage.close++;
  await assert.rejects(page.evaluate(value => repository.save([value]), conflict), /different metrics bar/);
  for (const invalid of [
    { ...bars[0], end: start + 60_000 },
    { ...bars[0], metrics: {} },
    { ...bars[0], metrics: { usage: { ...bars[0].metrics.usage, count: 0 } } },
    { ...bars[0], start: 9_000_000_000_000, end: 9_000_000_000_000 + duration },
  ]) await assert.rejects(page.evaluate(value => repository.save([value]), invalid));
  assert.deepEqual(await page.evaluate(() => repository.load()), bars.slice(0, 2));

  // Separate documents race through the dedicated writer lock and retain both appends.
  const secondPage = await openPage(context, baseURL);
  await Promise.all([
    page.evaluate(value => repository.save([value]), { ...bars[2], samples: [{ secretRawSample: true }] }),
    secondPage.evaluate(value => repository.save([value]), bars[3]),
  ]);
  assert.deepEqual(await secondPage.evaluate(() => repository.load()), bars);
  stored = await inspect(secondPage);
  assert.equal(stored.history.length, 4);
  assert.equal(stored.journal, false);
  assert.ok(stored.status.every(([, head, work, stage]) => head === 1 && work === 1 && stage === 1));
  assert.deepEqual(stored.history.map(commit => commit.files.length), [4, 3, 2, 1]);
  for (const commit of stored.history) for (const [index, filepath] of commit.files.entries()) {
    assert.match(filepath, /^bars\/\d{4}\/\d{2}\/\d{2}\/\d{2}-\d{2}\.json$/);
    const value = commit.values[index];
    assert.deepEqual(Object.keys(value), ["start", "end", "metrics"]);
    assert.equal(value.end - value.start, duration);
    assert.deepEqual(Object.keys(value.metrics.usage), ["open", "high", "low", "close", "count"]);
  }

  // A fresh document reconstructs history from durable IndexedDB, with no memory-only state.
  const reloaded = await openPage(context, baseURL);
  assert.deepEqual(await reloaded.evaluate(() => repository.load()), bars);
  assert.deepEqual(failures, []);
  pail.force.success("Metrics history passed: completed bars only, reload, idempotency, interruption recovery, conflict protection, and cross-tab writes.");
} finally {
  await browser?.close();
  await server.close();
}
