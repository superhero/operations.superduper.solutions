// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { evaluateOperations } from "./matching.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";

serveWorkerRpc({ evaluate: evaluateOperations });
