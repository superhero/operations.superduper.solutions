# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Verified native receipt storage boundaries
  Scenario: Verified configuration receipts advance encrypted authority once
    Then the private vault adopts a verified broker receipt and retains no-op and stale-reference boundaries

  Scenario: Configuration receipts retain exact method identity and private output boundaries
    Then the private vault rejects foreign receipts and credential-bearing configuration results

  Scenario: Receipt adoption retains cancellation revocation and storage ownership
    Then the private vault rejects cancelled revoked and replaced receipt owners without publication

  Scenario: Verified migration values remain encrypted and disappear with their connection
    Then imported private values are adopted once retained across relock and removed with their owner

  Scenario: Paired configuration transport correlates its verified authority receipt
    Then the paired configuration broker adopts only its owned verified receipt before publishing the result

  Scenario: Altered paired receipts cannot publish configuration results
    Then missing duplicate or altered configuration receipts close their owned request without adoption

  Scenario: Paired migration transport binds completion to private receipt adoption
    Then the paired migration broker binds completion and encrypted private values to the exact receipt

  Scenario: Altered migration receipts cannot publish imported private values
    Then missing duplicate or altered migration receipts close their owner without importing public credentials

  Scenario: Native controls retain exact selected capabilities and specialized dispatch
    Then private vault native controls require their exact selected capability and preserve specialized dispatch

  Scenario: Native authentication results retain pinned identities and separate credentials
    Then private vault authentication results cannot replace pinned runtime identity or borrow their pairing key

  Scenario: Native reads retain asynchronous cancellation and byte validation
    Then private vault native reads retain cancellation around schema guards and withhold malformed byte results

  Scenario: Standalone MCP sign-in retains final ownership and private result filtering
    Then private standalone MCP sign-in retains selection ownership and sanitizes its final result

  Scenario: Private native entrypoints retain key model and configuration authority
    Then private native entrypoints reject changed key model and configuration authority

  Scenario: Watch and command authority retain state across asynchronous guards
    Then private watch and command authority retain their exact state across asynchronous guards

  Scenario: Unwatch failures retain secret filtering and cancellation ownership
    Then private unwatch failures retain secret filtering cancellation and sibling ownership

  Scenario: Native result byte inspection retains its UTF-8 and nesting boundaries
    Then native result byte inspection preserves UTF-8 boundaries callback errors and the nesting limit

  Scenario: Private migration updates preserve sibling connections and credential edits
    Then private migration updates retain sibling connections and private values across credential edits

  Scenario: Empty private inventories remain valid without unrelated connections
    Then empty private native inventories remain valid without unrelated connection authority

  Scenario: Native control cancellation retains its signal owner and input diagnostics
    Then native controls preserve ordinary input errors and signal-owned cancellation

  Scenario: Configuration mutation families reject foreign authority receipts
    Then all configuration mutation families reject receipts for foreign configuration authority

  Scenario: Native sign-in adoption preserves sibling connections and private values
    Then native sign-in adoption updates only its selected connection and retains sibling private values
