# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@docker-http
Feature: Qualified Docker HTTP and read-only attachment contracts
  Scenario: Docker HTTP models retain native identities and require real destinations
    Then Docker HTTP source corrections preserve all native routes and refuse source drift

  Scenario: Docker progress streams keep all records and fail on provider errors
    Then Docker HTTP progress and events decode bounded JSON lines including legacy media labels

  Scenario: Docker registry inputs remain private through decoded echoes
    Then Docker HTTP registry and signing inputs require private bindings and redact decoded values

  Scenario: Docker registry authentication can return no token
    Then Docker HTTP registry and swarm results adopt credentials without publishing their raw values

  Scenario: Docker secret reads cannot disclose input only secret data
    Then Docker HTTP secret reads reject unexpected private data in JSON or legacy text replies

  Scenario: Docker WebSocket attachment requires an explicitly enabled read method
    Then Docker read only attachment preserves real WebSocket bytes and exact pairing scope

  Scenario: Docker WebSocket attachment refuses writes and incomplete results
    Then Docker read only attachment rejects stdin oversized truncated and cancelled responses

  Scenario: Docker WebSocket results retain vault and source authority
    Then Docker read only attachment uses encrypted profiles and withholds binary credential echoes
