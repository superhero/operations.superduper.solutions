// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const contracts = {
  "appearance-cache": [
    "the cached appearance paints before application code and IndexedDB access",
    "authoritative appearance replaces the cache without unsafe fallback writes"
  ],
  "runtime-errors": [
    "the runtime event retains its original details in exactly one transport report",
    "the error overlay shows the normalized diagnostic without invented frames or duplicate history"
  ],
  "settings-startup": [
    "settings failures retain saved values and provide navigable native cause details",
    "settings recovery preserves the document and rejects late writes",
    "error cause navigation preserves one report per failure"
  ],
  "resize-observer": [
    "startup and settings disclosure heights settle without ResizeObserver errors",
    "search and matching details settle at desktop and mobile widths",
    "operation schema wrapping and viewport changes settle without browser errors"
  ],
  "startup-progress": [
    "startup reports only completed stages and preserves its real storage lifecycle"
  ],
  "metrics-recorder": [
    "worker measurements retain native processing values while incomplete bars stay in memory",
    "completed metrics bars persist exactly once without mutating workflows",
    "one recorder owns sampling across tabs and hands over complete aggregates",
    "cached metrics remain a preview until durable history and fresh measurements arrive",
    "page lifecycle events maintain accurate worker accounting",
    "metrics collection remains usable when its optional cache is invalid or blocked",
    "metrics browser contexts contain no unexpected errors"
  ],
  "metrics-history-repository": [
    "interrupted metrics writes recover their journal and staged bar exactly once",
    "duplicate conflicting and invalid metrics writes preserve existing history",
    "concurrent documents and reload preserve complete clean metrics Git history"
  ],
  "schema-storage": [
    "schema documents have independent repositories and metadata contains no document bodies",
    "replacement and enablement preserve identity and immutable historical versions",
    "interrupted schema writes preserve the old revision or recover the durable commit",
    "schema renames preserve other repositories and persist without redundant commits",
    "schema ordering stays alphabetical across reload renames uploads and legacy preferences",
    "schema deletion removes only its repository and an intentionally empty catalog stays empty"
  ],
  "storage-namespace": [
    "namespace preparation preserves storage contents and requires proof before deleting legacy data"
  ],
  "schemas-settings": [
    "the full schema document copies intact and its lazy viewer retains focus and resets nested branches",
    "schema management loads its seeded documents in a dedicated worker",
    "an uploaded schema contributes a working workflow operation",
    "unrelated schema uploads retain workflow nodes without replaying requests",
    "schema replacement records its history and clears stale run results",
    "schema enablement YAML uploads and normalized downloads survive reload",
    "invalid schema documents cannot change existing state",
    "deleting one schema preserves other repositories and saved workflows",
    "editable schema names save on blur or Enter without redundant commits",
    "schema lists stay alphabetical without manual ordering controls or extra revisions",
    "large schema processing yields rendering frames while its worker persists operations",
    "schema management recovers after the origin-wide repository lock is released",
    "schema browser contexts contain no unexpected errors"
  ],
  "dev-overlay": [
    "developer toolbar settings persist and disabled tools cannot receive pointer or keyboard input",
    "saved appearance and source-linked native errors initialize the development overlay",
    "open development errors inherit live palette syntax colors and support dismissal and reopening",
    "a failed development reporting transport makes one attempt without recursive logging",
    "native Pail errors retain stack locations and later reports recover after transport failure",
    "the critical loading screen remains animated and accessible before saved settings and error injection"
  ]
};
