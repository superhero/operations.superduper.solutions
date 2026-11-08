# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-read
Feature: Paired native configuration and skill reads
  Reads share the owned SDK session without granting agent or configuration writes.

  Scenario: Configuration models retain native declarations and public typed ports
    Then configuration read models preserve wire declarations typed ports and parameter diagnostics
  Scenario: Configuration reads require neither a provider account nor the agent grant
    Then all four configuration reads use the same paired session without account or agent authority
  Scenario: Read authority cannot acquire agent methods or private filesystem roots
    Then configuration reads reject missing grants agent escalation and workspace escapes
  Scenario: Private SDK configuration and known encoded vault secrets stay private
    Then configuration read projections withhold private settings and reject credential echoes
  Scenario: Thread scoped feature reads retain loaded thread ownership
    Then feature reads accept only an owned loaded thread on the same approved session
  Scenario: Configuration source identity lock and cancellation revoke pending reads
    Then pending configuration reads revoke their owned attempt without replay or false completion
