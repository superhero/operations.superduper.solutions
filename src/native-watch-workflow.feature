# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-watch-workflow
Feature: Native filesystem changes in workflows
  Registration and changes retain native results, typed ports and owned lifecycle.

  Scenario: Watch models preserve native request results and timestamped notification ports
    Then native watch models round trip typed ports without inventing HTTP responses

  Scenario: A watch acknowledgement starts a stream while notification consumers wait
    Then native watch acknowledgements release the form and real events route the owned unwatch ID

  Scenario: Repeated native changes update charts and stopping a stream preserves the next form
    Then native watch samples update live charts without replaying downstream operations

  Scenario: Stopping a watch before its first event releases waiting workflow advancement
    Then native watch stop and run teardown release pending notification consumers

  Scenario: Terminal native root loss retains its final event and a visible stream error
    Then native watch root loss routes its last known path before stream termination

  Scenario: Invalid native stream values cannot masquerade as HTTP responses
    Then native watch runners reject unclassified samples before promotion
