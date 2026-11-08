@native-guardian
Feature: Actual SDK guardian denial provenance
  Scenario: A guardian denial is observed before its exact action is approved
    Then the actual SDK guardian denial can be approved using only its observed native action
  Scenario: The private workflow broker confirms one observed native Guardian denial
    Then the actual SDK Guardian workflow records its action only after human confirmation
