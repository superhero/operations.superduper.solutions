# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Google Storage media upload
  Scenario: Media correction preserves the native Storage inventory and peer contracts
    Then Google Storage media correction retains source provenance and all native identities

  Scenario: Private media upload preserves exact bytes MIME and encoded object names
    Then Google Storage media dispatch sends one private raw file and receives bounded Object JSON

  Scenario: Invalid or unsupported upload inputs cannot dispatch
    Then Google Storage media rejects missing names files multipart resumable and malformed binary inputs

  Scenario: Upload failures remain bounded and recover without replay
    Then Google Storage media failure recovery never retries implicitly or leaks a bearer token

  Scenario: Previous destination approval cannot authorize the upload route
    Then Google Storage media rejects missing credentials and stale destination bindings before dispatch

  Scenario: Changed native upload contracts cannot receive the correction
    Then Google Storage media rejects changed destinations parameters shapes and provenance
