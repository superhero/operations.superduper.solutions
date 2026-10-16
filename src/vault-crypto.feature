# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-crypto
Feature: Browser vault encryption and authenticated snapshots
  The vault keeps encrypted records and independently wrapped keys locally.
  Its authenticated inventory rejects selective rollback and metadata tampering.

  Scenario: Runtime vault keys cannot be exported
    Then vault creation and wrapping use temporary keys while unlocked runtime keys reject export

  Scenario: Every record and envelope authenticates its identity
    Then vault ciphertext rejects incorrect keys, tampering, and every changed context field

  Scenario: Password derivation uses the agreed binary Argon2id profile
    Then vault password derivation matches the independent Argon2id vector and preserves exact input

  Scenario: Invalid password metadata never reaches the KDF
    Then vault password derivation rejects unsupported profiles and invalid input before cryptographic work

  Scenario: Independent recovery and passkey derivation
    Then vault recovery and passkey wrapping keys are separated by HKDF purpose and salt

  Scenario: Snapshot fields have strict versioned bounds
    Then vault snapshots reject unsupported versions, malformed fields, oversized records, and duplicate identities

  Scenario: Unlock methods have independent metadata
    Then vault snapshots validate exact password, recovery, and passkey metadata

  Scenario: A manifest authenticates the complete inventory
    Then vault manifests reject selective rollback, omitted records, substituted envelopes, and revision relabeling

  Scenario: Complete historical snapshots cannot prove freshness
    Then complete authenticated older vault snapshots remain readable with their original key

  Scenario: Malformed JSON and cryptographic encodings fail safely
    Then vault encoding rejects ambiguous base64 and unsafe JSON without exposing input diagnostics

  Scenario: Browser cryptography can be unavailable
    Then vault cryptographic provider failures return safe unavailable errors

  Scenario: Recovery keys reject non-text input
    Then vault recovery derivation rejects non-string keys before cryptographic work
