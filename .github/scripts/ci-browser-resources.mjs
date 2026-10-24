// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { availableParallelism, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

const GiB = 1024 ** 3, MiB = 1024 ** 2;
export const browserResourcePolicy = Object.freeze({
  cpu: 4, jobMemoryGiB: 16, hostReserveGiB: 2, memoryGiB: 14, pids: 512, nodeHeapMiB: 512,
});

/** The VM also runs the OS, Actions runner and artifact controller outside Docker. */
export function browserResources({ ci = process.env.GITHUB_ACTIONS === 'true' || process.env.OPERATIONS_TEST_RESOURCE_PROFILE === 'ci',
  cpus = availableParallelism(), memoryBytes = totalmem() } = {}) {
  if (!Number.isSafeInteger(cpus) || cpus < 1 || !Number.isSafeInteger(memoryBytes) || memoryBytes < 1)
    throw new Error('Cannot determine browser runner capacity.');
  const memory = Math.floor(Math.min((ci ? browserResourcePolicy.memoryGiB : 2) * GiB,
    memoryBytes - browserResourcePolicy.hostReserveGiB * GiB) / MiB) * MiB;
  if (memory < GiB) throw new Error('Browser runner needs at least 1 GiB after the host reserve.');
  return { cpus: Math.min(ci ? browserResourcePolicy.cpu : 2, cpus), memoryBytes: memory,
    pids: ci ? browserResourcePolicy.pids : 256 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resources = browserResources();
  console.log(`${resources.cpus} ${resources.memoryBytes} ${resources.pids}`);
}
