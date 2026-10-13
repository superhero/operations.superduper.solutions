// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createRoutingSession } from './flow-routing/session.js';
import { serveWorkerRpc } from './worker-rpc.ts';

const session = createRoutingSession();
serveWorkerRpc({ calculate: session.calculate });
