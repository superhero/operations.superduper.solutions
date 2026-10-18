# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Built-in Vitest reports preserve evidence and reject incomplete certification

  Scenario: A diagnostic multi-project report retains cases, assets, coverage and attachments
    Given real Vitest results from all six Gherkin projects
    When the diagnostic test report is generated
    Then the built-in report preserves each project and its individual cases
    And report generation preserves original evidence and bundled assets

  Scenario: A partial diagnostic report visibly identifies a failed CI run and missing suites
    Given real Vitest results without the browser project
    When the diagnostic test report is generated
    Then the diagnostic report displays its failure warning as escaped text

  Scenario: Passing tiny controls cannot certify complete application validation
    Given real Vitest results from all six Gherkin projects
    When strict test report generation is attempted
    Then report generation rejects incomplete application evidence and removes stale output

  Scenario Outline: Invalid inputs cannot leave a stale successful test report
    Given real Vitest results from all six Gherkin projects
    And the input blob is "<problem>"
    When the diagnostic test report is generated
    Then report generation fails with input and output context and removes stale output

    Examples:
      | problem        |
      | missing        |
      | malformed JSON |
      | empty          |
      | invalid shape  |

  Scenario: Passing Gherkin cases cannot bypass a real V8 coverage threshold failure
    Given passing Gherkin cases with an unexecuted measured source file
    When Vitest executes them with every coverage threshold set to 100 percent
    Then every scenario and step passes while only the coverage gate fails
    And the coverage summary retains unexecuted source and missing branches
