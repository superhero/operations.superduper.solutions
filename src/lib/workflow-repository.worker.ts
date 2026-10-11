// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import "./worker-runtime.ts";
import { workflowRepository } from "./workflow-repository.ts";
import { setStartupReporter } from "./startup-reporter.ts";
import { serveWorkerRpc, emitWorkerEvent } from "./worker-rpc.ts";

setStartupReporter((stage, detail) => emitWorkerEvent("startup", { stage, detail }));
// Forward each repository notification once; the page does not rebroadcast it.
workflowRepository.subscribe(() => emitWorkerEvent("change", null));

serveWorkerRpc({
  initialize: workflowRepository.initialize,
  list: workflowRepository.list,
  load: workflowRepository.load,
  save: workflowRepository.save,
  remove: workflowRepository.remove,
  history: workflowRepository.history,
  readVersion: workflowRepository.readVersion,
  restore: workflowRepository.restore,
  checkout: workflowRepository.checkout,
  undo: workflowRepository.undo,
  redo: workflowRepository.redo,
});
