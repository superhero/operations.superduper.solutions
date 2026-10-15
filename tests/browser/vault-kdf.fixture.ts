// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import KdfWorker from "./vault-kdf.worker.fixture.ts?worker&inline";
export async function qualifyKdf() {
  const worker = new KdfWorker();
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.ok ? resolve(data) : reject(new Error(data.message));
      worker.onerror = () => reject(new Error("Qualification worker failed"));
      worker.postMessage({ action: "qualify" });
    });
  } finally { worker.terminate(); }
}
