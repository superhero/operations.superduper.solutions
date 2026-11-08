# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Private AWS JSON target execution
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
