# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@legacy-smoke @chromium-only
Feature: Browser contracts migrated from standalone smoke scripts
  Development modules, native browser persistence and diagnostics remain visible in the shared test report.

  @appearance-cache
  Scenario Outline: Appearance startup handles <condition> without sacrificing authoritative settings
    Given the isolated browser fixture "appearance-cache" uses "<condition>"
    Then the cached appearance paints before application code and IndexedDB access
    And authoritative appearance replaces the cache without unsafe fallback writes
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | stale-cache |
      | empty-settings |
      | corrupt-json |
      | invalid-cache |
      | unavailable-storage |
      | settings-failure |

  @runtime-errors
  Scenario Outline: Runtime normalization preserves the <condition> diagnostic
    Given the isolated browser fixture "runtime-errors" uses "<condition>"
    Then the runtime event retains its original details in exactly one transport report
    And the error overlay shows the normalized diagnostic without invented frames or duplicate history
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | resize-observer |
      | message-source |
      | native |
      | zero |
      | string |
      | circular |

  @settings-startup
  Scenario Outline: Settings storage recovers from <condition> while preserving native diagnostics
    Given the isolated browser fixture "settings-startup" uses "<condition>"
    Then settings failures retain saved values and provide navigable native cause details
    And settings recovery preserves the document and rejects late writes
    And error cause navigation preserves one report per failure
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | legacy-upgrade |
      | open |
      | transaction |
      | security |

  @resize-observer
  Scenario Outline: Disclosure layouts settle with <condition> motion
    Given the isolated browser fixture "resize-observer" uses "<condition>"
    Then startup and settings disclosure heights settle without ResizeObserver errors
    And search and matching details settle at desktop and mobile widths
    And operation schema wrapping and viewport changes settle without browser errors
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | no-preference |
      | reduce |

  @startup-progress
  Scenario Outline: Startup stages reflect the real <condition> lifecycle
    Given the isolated browser fixture "startup-progress" uses "<condition>"
    Then startup reports only completed stages and preserves its real storage lifecycle
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | saved |
      | settings-stall |
      | workflow-stall |
      | workflow-failure |
      | preview-hold |

  @metrics-recorder
  Scenario: Metrics workers persist isolated aggregates and hand over sampling across documents
    Given the isolated browser fixture "metrics-recorder" uses "lifecycle"
    Then worker measurements retain native processing values while incomplete bars stay in memory
    And completed metrics bars persist exactly once without mutating workflows
    And one recorder owns sampling across tabs and hands over complete aggregates
    And cached metrics remain a preview until durable history and fresh measurements arrive
    And page lifecycle events maintain accurate worker accounting
    And metrics browser contexts contain no unexpected errors
    And every assertion in the browser journey has completed

  @metrics-recorder
  Scenario Outline: Metrics collection tolerates a <condition> optional cache
    Given the isolated browser fixture "metrics-recorder" uses "<condition>"
    Then metrics collection remains usable when its optional cache is invalid or blocked
    And metrics browser contexts contain no unexpected errors
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | corrupt |
      | unavailable |

  @metrics-history-repository
  Scenario: Metrics Git history recovers interrupted writes and concurrent appends
    Given the isolated browser fixture "metrics-history-repository" uses "history"
    Then interrupted metrics writes recover their journal and staged bar exactly once
    And duplicate conflicting and invalid metrics writes preserve existing history
    And concurrent documents and reload preserve complete clean metrics Git history
    And every assertion in the browser journey has completed

  @schema-storage
  Scenario: Schema Git repositories isolate revisions and recover interrupted metadata writes
    Given the isolated browser fixture "schema-storage" uses "history"
    Then schema documents have independent repositories and metadata contains no document bodies
    And replacement and enablement preserve identity and immutable historical versions
    And interrupted schema writes preserve the old revision or recover the durable commit
    And schema renames preserve other repositories and persist without redundant commits
    And schema ordering stays alphabetical across reload renames uploads and legacy preferences
    And schema deletion removes disabled uploads while defaults remain protected
    And every assertion in the browser journey has completed

  @storage-namespace
  Scenario Outline: Storage namespace migration preserves the <condition> boundary
    Given the isolated browser fixture "storage-namespace" uses "<condition>"
    Then namespace preparation preserves storage contents and requires proof before deleting legacy data
    And every assertion in the browser journey has completed

    Examples:
      | condition |
      | fresh |
      | migration |
      | completed-copy |
      | cleanup-database |
      | cleanup-filesystem |

  @schemas-settings
  Scenario: Schema management preserves Git history workflow identity and alphabetical lists
    Given the isolated browser fixture "schemas-settings" uses "management"
    Then schema management loads its seeded documents in a dedicated worker
    And an uploaded schema contributes a working workflow operation
    And unrelated schema uploads retain workflow nodes without replaying requests
    And schema replacement records its history and clears stale run results
    And schema enablement YAML uploads and normalized downloads survive reload
    And invalid schema documents cannot change existing state
    And deleting one schema preserves other repositories and saved workflows
    And editable schema names save on blur or Enter without redundant commits
    And schema lists stay alphabetical without manual ordering controls or extra revisions
    And large schema processing yields rendering frames while its worker persists operations
    And schema browser contexts contain no unexpected errors
    And every assertion in the browser journey has completed

  @schemas-settings
  Scenario: Schema management can retry a repository lock held by another document
    Given the isolated browser fixture "schemas-settings" uses "initial-load-retry"
    Then schema management recovers after the origin-wide repository lock is released
    And schema browser contexts contain no unexpected errors
    And every assertion in the browser journey has completed

  @dev-overlay
  Scenario: Build error overlays close by button and Escape before application startup
    Given the isolated browser fixture "dev-overlay-dismiss" uses "build-error"
    Then build errors support button and keyboard dismissal before application startup
    And every assertion in the browser journey has completed

  @dev-overlay
  Scenario: Development tools preserve native diagnostics palettes and reporting recovery
    Given the isolated browser fixture "dev-overlay" uses "overlay"
    Then developer toolbar settings persist and disabled tools cannot receive pointer or keyboard input
    And saved appearance and source-linked native errors initialize the development overlay
    And open development errors inherit live palette syntax colors and support dismissal and reopening
    And a failed development reporting transport makes one attempt without recursive logging
    And native Pail errors retain stack locations and later reports recover after transport failure
    And the critical loading screen remains animated and accessible before saved settings and error injection
    And every assertion in the browser journey has completed

  @schemas-settings
  Scenario: The full schema viewer copies its entire document and preserves disclosure focus
    Given the isolated browser fixture "schemas-settings" uses "full-document"
    Then the full schema document copies intact and its lazy viewer retains focus and resets nested branches
    And schema browser contexts contain no unexpected errors
    And every assertion in the browser journey has completed
