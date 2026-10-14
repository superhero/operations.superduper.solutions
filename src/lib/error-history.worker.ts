// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { closeErrorHistory, readErrors, recordErrors } from "./error-history-storage.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";

serveWorkerRpc({ readErrors, recordErrors, closeErrorHistory });
