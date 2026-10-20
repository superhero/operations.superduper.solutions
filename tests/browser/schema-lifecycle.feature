# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-lifecycle
Feature: Targeted schema storage and independent history
  Disabled content stays unloaded while canonical content and Git history remain authoritative.

  Scenario: Metadata changes and disabled documents need no source decoding
    Then schema metadata and discovery avoid disabled and unrelated document reads

  Scenario: Renamed schemas use their current alphabetical position
    Then renamed examples and protected defaults sort by name when schema defaults initialize again

  Scenario: Factory label changes preserve authored names and canonical source ownership
    Then new factory labels refresh without decoding sources or replacing personal names

  Scenario: Derived cache corruption and source read failures remain recoverable
    Then schema cache repair preserves history and retries failed reads

  Scenario: Factory history survives updates without overwriting authored changes
    Then factory revisions retain independent Git ancestry and authored ownership

  Scenario: Schema deletion protects defaults and requires current disabled upload metadata
    Then deletion preserves default schemas and rejects enabled uploads before removing any saved data

  Scenario: A schema changed in another tab cannot publish an obsolete model
    Then schema model loading and credential policies reject a stale source revision

  Scenario: Interrupted factory history commits recover without duplicate revisions
    Then unfinished factory history writes recover before canonical models become usable

  Scenario: Batched canonical models share storage without weakening validation
    Then schema operation batches preserve canonical models and publish policies atomically

  Scenario: Reviewed corrections have separate published and working Git ancestry
    Then schema corrections and local edits survive independent published updates

  Scenario: An upstream-fixed schema no longer needs the local correction
    Then upstream-fixed authentication preserves both flow choices without duplicate patch content

  Scenario: Conflicting upstream edits wait for current-revision-bound decisions
    Then schema conflicts survive reload and reject obsolete review decisions

  Scenario: Interrupted correction-branch publication recovers atomically
    Then interrupted schema correction branches recover without duplicate commits

  Scenario: Identical content still records the newly integrated source ancestry
    Then already applied schema edits merge their upstream ancestry exactly once

  Scenario: Discarding a proposal preserves the current schema and source tips
    Then discarded conflicting schema updates leave current content and ancestry unchanged

  Scenario: Any saved schema commits can be compared without changing history
    Then schema diffs preserve arbitrary comparison endpoints and load exact field changes separately

  Scenario: Applying the current bundle preserves schema names ownership and history
    Then unchanged bundled revisions preserve factory metadata and authored changes
