@runner-fixture @positive @feature-tag
Feature: Primary Gherkin compatibility
  Background:
    Given the feature background has run

  Scenario: DataTables and typed docstrings preserve values
    Given the following records:
      | name | amount |
      | foo  | 2      |
      | bar  | 3      |
    And the following JSON:
      """json
      {"hello":"world","count":5}
      """
    Then the table and document retain their data

  Scenario: Mutation remains in its scenario
    Given I mutate only this scenario world
    Then this world contains the private mutation

  Scenario: A subsequent scenario starts without that mutation
    Then this world has no previous scenario mutations

  @outline-tag
  Scenario Outline: Ordinary outline row <value>
    Given the example value is <value>
    Then the example value is preserved as <value>
    Examples:
      | value |
      | 1     |
      | 2     |

  @rule-tag
  Rule: Rule backgrounds preserve feature context
    Background:
      Given the rule background has run

    @scenario-tag
    Scenario: Rules retain backgrounds and inherited tags
      Then feature and rule backgrounds have run in order
      And the feature, rule and scenario tags are available
