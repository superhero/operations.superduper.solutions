# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@github-authentication
Feature: GitHub operation authentication
  Scenario: Pinned GitHub authentication preserves published inventory and every active operation
    Then GitHub authentication covers the native inventory and separates public access from permission-free access

  Scenario: Retired GitHub Classroom endpoints leave only the active catalog
    Then GitHub Classroom retirement preserves the upstream source and every nonretired operation

  Scenario: GitHub Classroom retirement refuses changed identities and exclusion provenance
    Then GitHub Classroom retirement rejects changed routes authentication and retirement markers

  Scenario: GitHub user app and installation requests use their selected private profiles
    Then GitHub token roles dispatch privately without anonymous or cross-profile fallback

  Scenario: GitHub repository subscriptions use scoped classic user credentials
    Then GitHub watching requests preserve method body scopes and private token roles

  Scenario: GitHub enterprise and personal Spaces retain their documented classic user scope contracts
    Then GitHub classic route families preserve exact scopes account roles and native identities

  Scenario: GitHub enterprise and personal Spaces dispatch private requests for every qualified route
    Then GitHub classic route requests preserve all methods bodies and token role boundaries

  Scenario: GitHub classic user permission denials do not trigger credential fallbacks
    Then GitHub classic scope role and entitlement failures remain provider denials

  Scenario: GitHub reviewed user APIs preserve task migration and personal project authority
    Then GitHub user API contracts keep token roles ownership scopes and native request schemas

  Scenario: GitHub reviewed user APIs execute their exact private requests
    Then GitHub user API wires preserve body variants arrays null and method scoped approval

  Scenario: GitHub reviewed user APIs keep provider permission and entitlement failures private
    Then GitHub user API denials fail without credential fallback or automatic mutation retries

  Scenario: GitHub manifest conversion and release upload retain their distinct authorities
    Then GitHub manifest and upload contracts keep private code and upload host boundaries

  Scenario: GitHub manifest conversion privately adopts every returned app credential
    Then GitHub manifest codes and acquired credentials remain encrypted across vault locking

  Scenario: GitHub manifest failures never partially save or expose credentials
    Then GitHub manifest expiry revocation and storage failure leave no partial acquisition

  Scenario: GitHub release uploads send exact raw file bytes using a reviewed token
    Then GitHub release asset requests preserve binary content names media and mutation failures

  Scenario: Current GitHub automation contracts preserve every native alias and source declaration
    Then GitHub automation correction preserves native IDs original evidence and strict model parity

  Scenario: GitHub automation token alternatives use exact repository routes and current bodies
    Then GitHub automation wires retain ownership types repository inputs and token alternatives

  Scenario: GitHub automation removed parameters and installation ownership fail before requests
    Then GitHub automation legacy fields missing repositories and incompatible token context never dispatch

  Scenario: GitHub automation correction rejects schema drift and forged routing markers
    Then GitHub automation source and marker changes cannot bypass their pinned wire contracts

  Scenario: Documented GitHub public resources still execute anonymously
    Then GitHub public choices dispatch without credentials and cannot unlock private routes

  Scenario: GitHub OAuth app Basic credentials and token inputs stay private
    Then GitHub OAuth app references dispatch Basic privately while credential results stay private

  @coverage-gaps
  Scenario: GitHub corrections retain provenance and reject changed contracts
    Then GitHub corrections are isolated idempotent and bounded to their reviewed routes and origins
