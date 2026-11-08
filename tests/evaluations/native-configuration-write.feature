# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-write
Feature: Verified private configuration adoption
  Scenario: Private writes persist their exact runtime identity
    Then the private vault adopts verified writes and keeps direct stale references invalid
  Scenario: Private writes retain unrelated vault records and loaded threads
    Then the private vault preserves unrelated records and its loaded thread across writes
  Scenario: Private writes require their owned configuration receipt
    Then the private vault rejects missing replayed or mismatched configuration receipts
  Scenario: Private writes retain cancellation revocation privacy and storage CAS
    Then the private vault does not adopt cancelled revoked conflicting or newly private results
