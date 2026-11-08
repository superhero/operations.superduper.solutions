# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified relative Atlassian service destinations
  Scenario: Every relative Atlassian operation retains its source and run requirements
    Then all 167 relative Atlassian operations retain their identities and can be inserted before destination configuration

  Scenario: Relative destination corrections reject source drift atomically
    Then relative Atlassian corrections reject changed routes authentication bodies and server declarations before mutation

  Scenario: Relative destination corrections preserve path metadata
    Then relative Atlassian corrections preserve non-operation path metadata

  Scenario: Both documented product destinations dispatch with their actual authentication
    Then Confluence Focus and App Migration use their documented site cloud and product bases without duplicated paths

  Scenario: Invalid account destinations cannot acquire execution authority
    Then relative Atlassian destinations reject malformed identifiers unconfigured models and changed credential approvals

  Scenario: Native Confluence attachments preserve text and file parts
    Then all three Confluence attachment operations send exact file bytes Unicode comments boolean minor edits and XSRF headers

  Scenario: Connect dynamic modules preserve the complete JSON module map
    Then Confluence dynamic module requests retain arbitrary module definitions with private Connect authentication

  Scenario: Signed migration data URLs stay in Secrets
    Then App Migration privately adopts returned signed URLs and withholds failed adoption results

  Scenario: Connect credentials have no public or bearer fallback
    Then Connect JWT requests reject missing malformed cross-origin and public credentials without exposing raw token values
