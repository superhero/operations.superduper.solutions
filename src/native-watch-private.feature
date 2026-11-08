# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-watch-private
Feature: Private native filesystem watch ownership
  Watch subscriptions retain encrypted pairing authority for every published value.

  Scenario: Persistent watch requests allow one ordinary vault command and keep global limits
    Then native watch worker admission preserves ordinary command serialization and bounded subscriptions

  Scenario: Encrypted watch subscriptions preserve acknowledgements notifications and native unwatch barriers
    Then a private native watch publishes typed values until its explicit native unwatch

  Scenario: Cancelling one private watch preserves sibling subscriptions and rejects busy role changes
    Then private native watch cancellation owns one watch ID and preserves other subscriptions

  Scenario: Private watches enforce independent grants exact schemas and secret-free inputs
    Then private native watches reject missing grants altered selections and credential inputs

  Scenario: Private watch publication rechecks source authority and credential inventories
    Then private native watch events withhold stale source and known credential values

  Scenario: Vault changes revoke subscriptions before adopting new credential state
    Then credential mutation and vault locking revoke private native watches

  Scenario: Early native notifications and cancellation wait for the owned acknowledgement
    Then a private native watch orders early events and cancellation across registration

  Scenario: A private native watch publishes its terminal known root before reporting authority loss
    Then private native root loss preserves the final notification and ends the subscription
