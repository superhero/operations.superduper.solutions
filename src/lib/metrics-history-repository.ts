// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import { metricsBarDuration, type MetricCandle, type MetricsBar } from "./metrics-history.ts";
import { metricsFilesystemName } from "./storage-names.ts";
export { metricsFilesystemName } from "./storage-names.ts";

if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, configurable: true, writable: true });

const dir = "/metrics";
const journal = `${dir}/.git/metrics-pending.json`;
const author = { name: "Local metrics collector", email: "metrics@localhost" };
const filesystems = new Map<string, LightningFS>();
const queues = new Map<string, Promise<unknown>>();

function missing(error: unknown): boolean
{
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function validate(value: unknown): MetricsBar
{
  if (!value || typeof value !== "object") throw new Error("The saved metrics bar is invalid.");
  const candidate = value as Partial<MetricsBar>;
  if (!Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end)
    || candidate.start! % metricsBarDuration !== 0 || candidate.end !== candidate.start! + metricsBarDuration
    || !Number.isFinite(new Date(candidate.start!).getTime()) || !candidate.metrics || typeof candidate.metrics !== "object"
    || Array.isArray(candidate.metrics)) throw new Error("Metrics history requires complete 15-minute bars.");
  const entries = Object.entries(candidate.metrics).sort(([left], [right]) => left.localeCompare(right)).map(([name, candle]) => {
    if (!candle || typeof candle !== "object" || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
      || !Number.isSafeInteger(candle.count) || candle.count < 1
      || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)
      || candle.low > candle.high) throw new Error("The saved metrics candle is invalid.");
    return [name, { open: candle.open, high: candle.high, low: candle.low, close: candle.close, count: candle.count } satisfies MetricCandle] as const;
  });
  if (!entries.length) throw new Error("Empty metrics bars are not saved.");
  return { start: candidate.start!, end: candidate.end, metrics: Object.fromEntries(entries) };
}

function filepath(bar: MetricsBar): string
{
  const iso = new Date(bar.start).toISOString();
  return `bars/${iso.slice(0, 10).replaceAll("-", "/")}/${iso.slice(11, 16).replace(":", "-")}.json`;
}

const serialize = (bar: MetricsBar) => `${JSON.stringify(bar)}\n`;

/** Separate from workflow history: only completed bars enter this filesystem or its Git index. */
export function createMetricsHistoryRepository(options: { filesystemName?: string } = {})
{
  const name = options.filesystemName ?? metricsFilesystemName;
  const lock = `metrics-history:${name}`;
  let fs: LightningFS;
  let ready = false;

  async function read(path: string): Promise<string | null>
  {
    try { return await fs.promises.readFile(path, "utf8"); }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  async function mkdir(path: string): Promise<void>
  {
    let current = "";
    for (const segment of path.split("/").filter(Boolean))
    {
      current += `/${segment}`;
      try { await fs.promises.mkdir(current); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    }
  }

  async function committed(bar: MetricsBar): Promise<boolean>
  {
    const path = filepath(bar);
    const existing = await read(`${dir}/${path}`);
    if (existing !== null && serialize(validate(JSON.parse(existing))) !== serialize(bar))
      throw new Error("A different metrics bar already exists for this 15-minute interval.");
    const [status] = await git.statusMatrix({ fs, dir, filepaths: [path] });
    if (!status || status[1] === 0) return false;
    if (status[2] !== 1 || status[3] !== 1)
      throw new Error("Committed metrics history was changed outside the metrics collector.");
    return true;
  }

  async function finish(bar: MetricsBar): Promise<void>
  {
    if (!await committed(bar))
    {
      const path = filepath(bar);
      await mkdir(`${dir}/${path.slice(0, path.lastIndexOf("/"))}`);
      await fs.promises.writeFile(`${dir}/${path}`, serialize(bar), "utf8");
      await fs.promises.flush();
      await git.add({ fs, dir, filepath: path });
      await git.commit({ fs, dir, message: `Record metrics for ${new Date(bar.start).toISOString()}`, author });
    }
    await fs.promises.flush();
  }

  async function clearJournal(): Promise<void>
  {
    try { await fs.promises.unlink(journal); }
    catch (error) { if (!missing(error)) throw error; }
    await fs.promises.flush();
  }

  async function recoverPending(): Promise<void>
  {
    const text = await read(journal);
    if (text === null) return;
    await finish(validate(JSON.parse(text)));
    await clearJournal();
  }

  async function append(bar: MetricsBar): Promise<void>
  {
    if (await committed(bar)) return;
    // The journal holds only a completed bar and is flushed before changing the worktree.
    await fs.promises.writeFile(journal, serialize(bar), "utf8");
    await fs.promises.flush();
    await finish(bar);
    await clearJournal();
  }

  async function initialize(): Promise<void>
  {
    if (ready) return;
    fs = filesystems.get(name) ?? new LightningFS(name);
    filesystems.set(name, fs);
    await mkdir(dir);
    if (await read(`${dir}/.git/HEAD`) === null) await git.init({ fs, dir, defaultBranch: "main" });
    await recoverPending();
    // Startup recovery also finds completed files left before they entered the index.
    const pending: { path: string; bar: MetricsBar }[] = [];
    for (const [path, head, work, stage] of await git.statusMatrix({ fs, dir }))
    {
      if (head === 1 && work === 1 && stage === 1) continue;
      if (head !== 0 || work === 0) throw new Error("Committed metrics history has an unexpected change.");
      const text = await read(`${dir}/${path}`);
      const bar = validate(JSON.parse(text!));
      if (path !== filepath(bar)) throw new Error("A metrics history file does not match its interval.");
      pending.push({ path, bar });
    }
    // Validate every pending file before staging any; discard stale index entries, not files.
    for (const item of pending) await git.resetIndex({ fs, dir, filepath: item.path });
    for (const item of pending.sort((left, right) => left.bar.start - right.bar.start)) await append(item.bar);
    await fs.promises.flush();
    ready = true;
  }

  async function locked<T>(task: () => Promise<T>): Promise<T>
  {
    const previous = queues.get(name) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (!globalThis.navigator?.locks) throw new Error("This browser cannot safely lock metrics history for saving.");
      return navigator.locks.request(lock, async () => {
        try { await initialize(); await recoverPending(); return await task(); }
        catch (error) { ready = false; throw error; }
      });
    });
    queues.set(name, pending);
    try { return await pending; }
    finally { if (queues.get(name) === pending) queues.delete(name); }
  }

  return {
    load(): Promise<MetricsBar[]>
    {
      return locked(async () => {
        const bars: MetricsBar[] = [];
        for (const path of await git.listFiles({ fs, dir }))
        {
          const text = await read(`${dir}/${path}`);
          const bar = validate(JSON.parse(text!));
          if (path !== filepath(bar)) throw new Error("A metrics history file does not match its interval.");
          bars.push(bar);
        }
        return bars.sort((left, right) => left.start - right.start);
      });
    },
    save(bars: MetricsBar[]): Promise<void>
    {
      // Snapshot before queuing so later caller mutations cannot change a pending save.
      let snapshot: MetricsBar[];
      try
      {
        snapshot = bars.map(validate).sort((left, right) => left.start - right.start);
        if (snapshot.some(bar => bar.end > Date.now())) throw new Error("A metrics interval must finish before it can be saved.");
      }
      catch (error) { return Promise.reject(error); }
      return locked(async () => { for (const bar of snapshot) await append(bar); });
    },
  };
}

export const metricsHistoryRepository = createMetricsHistoryRepository();
