// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import WorkflowWorker from "./workflow-repository.worker.ts?worker&inline";
import { createWorkerClient } from "./worker-rpc.ts";
import { reportStartup, type StartupStage } from "./startup-progress.ts";
import type { workflowRepository as repository } from "./workflow-repository.ts";

type Repository = typeof repository;
type RemoteMethod = Exclude<keyof Repository, "subscribe" | "storageMetrics">;
const client = createWorkerClient(() => new WorkflowWorker({ name: "operations-workflows" }));
const listeners = new Set<() => void>();

client.subscribe(event => {
  if (event.type === "startup") {
    const { stage, detail } = event.data as { stage: StartupStage; detail?: string };
    reportStartup(stage, detail);
  } else if (event.type === "change") {
    for (const listener of listeners) listener();
  }
});

function remote<Method extends RemoteMethod>(method: Method): Repository[Method]
{
  return ((...args: unknown[]) => client.call(method, args)) as Repository[Method];
}

/** The editor keeps one repository owner alive so startup, history and autosaves stay off the UI thread. */
export const workflowRepository = {
  initialize: remote("initialize"),
  list: remote("list"),
  load: remote("load"),
  save: remote("save"),
  remove: remote("remove"),
  history: remote("history"),
  readVersion: remote("readVersion"),
  restore: remote("restore"),
  checkout: remote("checkout"),
  undo: remote("undo"),
  redo: remote("redo"),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

import.meta.hot?.dispose(() => { client.dispose(); listeners.clear(); });
