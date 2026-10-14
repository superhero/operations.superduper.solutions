# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@worker-rpc
Feature: Worker messaging
  Background requests preserve results and error diagnostics across worker lifecycles.

  Scenario: Worker calls start lazily, correlate responses, forward events, and preserve error chains
    Then worker calls start lazily, correlate responses, forward events, and preserve error chains

  Scenario: Disposing a worker drains an accepted write before termination
    Then disposing a worker drains an accepted write before termination

  Scenario: Worker crashes reject pending calls and a later explicit call can retry
    Then worker crashes reject pending calls and a later explicit call can retry

  Scenario: Worker transport failures without diagnostics reject pending calls and terminate the worker
    Then worker transport failures without diagnostics reject pending calls and terminate the worker

  Scenario: Worker server preserves native error diagnostics and rejects unlisted methods
    Then worker server preserves native error diagnostics and rejects unlisted methods

  Scenario: Worker messages round-trip results, aggregate failures, and bounded circular causes
    Then worker messages round-trip results, aggregate failures, and bounded circular causes
