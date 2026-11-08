# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@credential-results
Feature: Private adoption of returned credentials
  Scenario: Every native private result becomes a reference without changing metadata
    Then all 27 native credential result requests preserve their wire contract and return only references

  Scenario: Private response projection retains its pinned native evidence
    Then private result projections preserve upstream contracts and reject drift and forged profiles

  Scenario: Nested nullable masked repeated and multi-key results retain their meaning
    Then private result extraction handles nullable nested arrays masks and multiple secret leaves

  Scenario: Acquired Unicode secrets persist only inside the encrypted vault
    Then credential results survive vault lock and unlock without entering public records or transport

  Scenario: Lock cancellation source revocation and storage conflicts prevent adoption
    Then interrupted acquisitions return a safe unconfirmed result without partial storage

  Scenario: Untrusted malformed failed and oversized results never escape
    Then failed credential result responses never publish raw bodies headers or stream samples

  Scenario: Private request inputs require connected vault references
    Then credential-producing requests refuse plaintext token inputs and unknown destinations

  Scenario: Anonymous credential results still require an unlocked private executor
    Then public HTTP execution cannot bypass anonymous private result adoption

  Scenario: Batches of acquired secrets commit atomically
    Then multiple returned credentials commit together or leave the vault unchanged

  Scenario: Private result metadata cannot authorize unsafe origins or unclassified values
    Then private result boundaries reject invalid destinations response parents and adoption references

  Scenario: Private result projections preserve nullable oneOf wrappers
    Then private result projections preserve nullable oneOf resource wrappers

  Scenario: Unconfirmed private acquisitions cannot publish response values
    Then private acquisitions withhold unconfirmed transport and cancelled post-response results

  Scenario: Acquisition cancellation during final schema validation cannot publish secrets
    Then private result adoption cancelled during its final schema check cannot persist acquired credentials
