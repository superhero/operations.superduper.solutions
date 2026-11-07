// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Keep upstream sample credentials out of distributed Docker schemas. */
export function redactDockerCredentialExamples(document) {
  return JSON.parse(JSON.stringify(document, (_key, value) => typeof value === 'string'
    ? value.replace(/SWMTKN-\d-[A-Za-z0-9+/=_-]+/g, '<docker-swarm-join-token>')
      .replace(/SWMKEY-\d-[A-Za-z0-9+/=_-]+/g, '<docker-swarm-unlock-key>')
    : value));
}
