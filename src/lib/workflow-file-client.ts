// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import FileWorker from "./workflow-file.worker.ts?worker&inline";
import { createWorkerClient } from "./worker-rpc.ts";
import { csvOptions, type CsvOptions, type UploadedWorkflowFile } from "./workflow-file.ts";

export async function parseWorkflowFileAsync(input: File | UploadedWorkflowFile, options: CsvOptions, signal: AbortSignal): Promise<UploadedWorkflowFile> {
  signal.throwIfAborted();
  options = csvOptions(options);
  const client = createWorkerClient(() => new FileWorker({ name: "workflow-file" }), { reportErrors: false, scope: "workflow-file" });
  const abort = () => client.dispose(true);
  signal.addEventListener("abort", abort, { once: true });
  try {
    // Parsing is read-only: one fresh worker can recover a transient module-load
    // failure (for example while Vite refreshes optimized dependencies).
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        const result = input instanceof File
          ? await client.call<UploadedWorkflowFile>("upload", [input, options])
          : await client.call<UploadedWorkflowFile>("parse", [input.name, input.source, options, input.encoding]);
        signal.throwIfAborted();
        return result;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt !== 0 || !(error instanceof Error) || error.name !== "WorkerError") throw error;
      }
    }
  } finally { signal.removeEventListener("abort", abort); client.dispose(true); }
}
