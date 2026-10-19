# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-lifecycle
Feature: Targeted schema storage and independent history
  Disabled content stays unloaded while canonical content and Git history remain authoritative.

  Scenario: Metadata changes and disabled documents need no source decoding
    Then schema metadata and discovery avoid disabled and unrelated document reads

  Scenario: Schema name changes do not repeat initial alphabetical sorting
    Then renamed remaining examples retain their order when schema defaults initialize again

  Scenario: Factory label changes preserve authored names and canonical source ownership
    Then new factory labels refresh without decoding sources or replacing personal names

  Scenario: Derived cache corruption and source read failures remain recoverable
    Then schema cache repair preserves history and retries failed reads

  Scenario: Factory history survives updates without overwriting authored changes
    Then factory revisions retain independent Git ancestry and authored ownership

  Scenario: A schema changed in another tab cannot publish an obsolete model
    Then schema model loading and credential policies reject a stale source revision

  Scenario: Interrupted factory history commits recover without duplicate revisions
    Then unfinished factory history writes recover before canonical models become usable

  Scenario: Batched canonical models share storage without weakening validation
    Then schema operation batches preserve canonical models and publish policies atomically
