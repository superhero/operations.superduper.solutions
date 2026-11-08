# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Pinned AWS JSON target wire contracts
  Scenario: Every JSON target retains its pinned SDK constraints and authority
    Then all 1784 JSON targets have immutable reviewed wire contracts and finite input schemas

  Scenario: JSON target requests encode timestamp and binary values before signing
    Then JSON target codecs preserve versions target headers timestamps and base64 bytes

  Scenario: Recursive DynamoDB input retains validation within bounded traversal
    Then recursive JSON target values reject malformed unknown and out of range input

  Scenario: Cognito no IAM operations and Step Functions sync origins follow the SDK
    Then JSON target authentication and host prefixes follow each pinned SDK operation

  Scenario: JSON target signatures cover final protocol headers and exact bytes
    Then independently verified AWS signatures bind JSON target headers and payloads

  Scenario: JSON target response decoding rejects malformed media and oversized data
    Then JSON target responses preserve typed outputs and reject invalid wire representations

  Scenario: JSON target pattern annotations retain their qualified AWS semantics
    Then the pinned AWS JSON pattern translations retain Unicode bounds character sets and scoped flags

  Scenario: JSON canonical models retain exact SDK fields and reject stale revisions
    Then every JSON target has a strict canonical input model with its exact authentication choice
