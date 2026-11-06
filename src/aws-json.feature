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

  Scenario: SDK credential schemas preserve recursive structure and public metadata
    Then SDK private response schemas retain recursive references and public metadata without changing input components

  Scenario: SDK credential adoption classifies recursive fields and named map entries
    Then SDK private adoption handles recursive passwords credential maps tokens and public keys

  Scenario: All native JSON targets load through both catalog parsers
    Then all native AWS JSON targets have matching strict and capability models with qualified private results

  Scenario: Every JSON provider signs its final private request bytes
    Then all twenty eight native JSON providers sign their exact target headers and request bytes

  Scenario: Cognito authentication needs no IAM key and persists acquired values privately
    Then unsigned Cognito authentication adopts results atomically through encrypted vault reload

  Scenario: Cognito private fields cannot dispatch to public or changed origins
    Then JSON private input and no IAM origin guards reject public passwords before dispatch

  Scenario: JSON description synopses fit workflows without discarding source documentation
    Then the twenty four native JSON description synopses persist while the complete source documentation remains available
