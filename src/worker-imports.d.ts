// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
declare module "*?worker&inline" {
  const WorkerConstructor: { new(options?: WorkerOptions): Worker };
  export default WorkerConstructor;
}
