// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readWorkflowFile, parseWorkflowFile, maxWorkflowUploadBytes, type CsvOptions } from "./workflow-file.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";
serveWorkerRpc({
  async upload(file: File, options: CsvOptions) {
    if (file.size > maxWorkflowUploadBytes) throw new Error("Files must be no larger than 500 kB.");
    return readWorkflowFile(file.name, new Uint8Array(await file.arrayBuffer()), file.type, options);
  },
  parse: parseWorkflowFile,
});
