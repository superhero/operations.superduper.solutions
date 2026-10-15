# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@live-prompt
Feature: Automatic operation discovery in navigation
  Scenario: Matching keeps the catalog groups and opens every matching path
    Then the sidebar prompt filters operations while retaining their catalog groups

  Scenario: Clearing the prompt restores the manual browsing path
    Then clearing live matching restores the unfiltered catalog and its previous expansion

  Scenario: New input cancels a running calculation and ignores its late result
    Then newer prompt text cancels the pending worker and owns the displayed matches

  Scenario: Mobile matching selects an operation without stealing typing focus
    Then mobile prompt matching preserves editing focus until an operation is selected

  Scenario: The sidebar prompt grows with multiline input without its own scrollbar
    Then a long prompt grows inside navigation while its buttons and menu remain usable
