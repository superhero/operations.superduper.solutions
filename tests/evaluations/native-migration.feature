# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-migration
Feature: Actual SDK migration lifecycle foundation
  Scenario: Private migration adoption preserves encrypted records and references
    Then the private vault adopts imported values with fresh records and hides them across relock and removal
  Scenario: Private migration adoption retains cancellation revocation privacy and storage CAS
    Then the private vault rejects cancelled revoked conflicting and newly private import acknowledgements
  Scenario: Private migration imports retain loaded threads and MCP configuration
    Then verified imports retain a loaded thread and configured MCP calls in the same owned SDK child
  Scenario: Native migration source selection and completion survive SDK restart
    Then the pinned SDK separates migration selectors acknowledgement completion and persistent history
  Scenario: Native migration history and repository scope retain their own effects
    Then the pinned SDK records external history and retains repository redirection semantics
  Scenario: Native home skills and history retain their actual storage scopes
    Then the pinned SDK home skill imports use the Codex parent and history uses its configured database
  Scenario: Migration runtime confines the whole private source and target home
    Then the migration runtime protects the complete source target home and isolates native history
  Scenario: Migration isolation preserves separately granted configuration writes
    Then migration root isolation keeps separately granted configuration writes compatible
  Scenario: Migration runtime rejects unsafe private root layouts
    Then migration startup rejects missing shared redirected or workspace overlapping private roots
  Scenario: Migration scope preflight matches actual SDK destinations
    Then migration scope preflight binds the actual SDK repository and verifies its unchanged source
  Scenario: Native migration imports all ten item types with real effects
    Then the pinned SDK imports all ten native migration kinds and persists their completion history
  Scenario: Imported sandbox preferences preserve runtime tool permissions
    Then migrated sandbox preferences retain the fixed runtime profile and deny tool reads of the private home
  Scenario: File only migration advances owned effect authority
    Then a verified instruction import advances file effect identity and rejects completed context replay
  Scenario: Owned migration metadata methods preserve their authority
    Then owned migration metadata methods and empty imports preserve file and credential authority
  Scenario: Interrupted imports cannot reuse uncertain file authority
    Then interrupted imports invalidate only dispatched uncertain file authority and cannot be replayed
  Scenario: Owned migration protocol withholds acknowledgement until verification
    Then the owned agent protocol correlates SDK completion and sends its private receipt before the result
  Scenario: Global migration effects ignore repository display scope
    Then memory and session imports with repository cwd retain global destinations and effect authority
  Scenario: Import verification remains bounded as stored history grows
    Then owned import verification reads its persisted row without fetching the accumulated history
  Scenario: Owned Cursor plugins retain native source and effect scopes
    Then the pinned SDK imports a Cursor cached marketplace through the owned effect verifier
  Scenario: Configured marketplaces override unused provider source paths
    Then the pinned SDK imports an owned configured marketplace without reading its unused provider cache
  Scenario: Private migration broker retains request ownership through adoption
    Then the private migration broker accepts all four methods and holds its owner through verified adoption
  Scenario: Private migration broker requires its exact authority receipt
    Then the private migration broker rejects missing duplicate tampered and unsolicited authority receipts
  Scenario: Private migration metadata withholds transcript and failure text
    Then the private broker withholds actual native session titles and persisted failure contents
