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
    const result = input instanceof File
      ? await client.call<UploadedWorkflowFile>("upload", [input, options])
      : await client.call<UploadedWorkflowFile>("parse", [input.name, input.source, options, input.encoding]);
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener("abort", abort); client.dispose(true); }
}
