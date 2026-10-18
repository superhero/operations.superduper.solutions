# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@coverage-report
Feature: Portable Vitest test and coverage report
  The built-in report and coverage remain usable as one complete static directory.

  Scenario: Native coverage navigation retains file identities and source line links
    Given a generated Vitest report is served by a plain HTTP server
    When I browse coverage folders and filter filenames that differ only in punctuation
    Then coverage retains both executed and unexecuted files in its measured scope
    When I open a source line directly and navigate its browser history
    Then source text line anchors and reloads retain the selected file and line
    And the report uses only its packaged assets with optional external typography blocked

  Scenario: Gherkin results retain searchable identities and downloadable browser evidence
    Given a generated Vitest report is served by a plain HTTP server
    Then the dashboard accounts for every passing Gherkin case and canonical example identity
    When I filter the report and open its browser evidence scenario
    Then its screenshot is viewable and its trace attachment is downloadable
    And the report uses only its packaged assets with optional external typography blocked

  Scenario: Relocating the complete report directory preserves coverage and attachments
    Given the complete Vitest report directory has moved away from its generating workspace
    Then the dashboard accounts for every passing Gherkin case and canonical example identity
    When I browse coverage folders and filter filenames that differ only in punctuation
    And I filter the report and open its browser evidence scenario
    Then its screenshot is viewable and its trace attachment is downloadable
    And the report uses only its packaged assets with optional external typography blocked
