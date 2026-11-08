# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified multipart roots
  Scenario: Reviewed root corrections retain their upstream declarations
    Then the nine multipart root corrections are reversible without changing shared schemas

  Scenario: Multipart root source drift is rejected before mutation
    Then changed multipart root declarations cannot be applied partially

  Scenario: Required-only multipart alternatives remain exclusive
    Then multipart file or URL choices retain exclusivity constraints and definition references

  Scenario: All twelve native multipart roots send their qualified file bodies
    Then twelve native multipart root operations preserve file bytes and private authorization

  Scenario: Malformed native root files cannot dispatch
    Then malformed files for the twelve multipart root operations fail before transport

  Scenario: Required-field alternatives are part of private authority
    Then a changed multipart required-field choice cannot reuse an earlier credential binding

  Scenario: Jira attachment synopsis survives workflow persistence
    Then the corrected operation "jira:addAttachment" has persistable display metadata and retains its source documentation
