// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { serveWorkerRpc } from "./worker-rpc.ts";
import { processWorkflowValue } from "./workflow-processing.ts";
serveWorkerRpc({ process: processWorkflowValue });
