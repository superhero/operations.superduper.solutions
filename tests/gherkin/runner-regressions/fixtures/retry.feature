@runner-fixture @retry
Feature: Retries preserve isolation and expose attempts
  Scenario: One failing attempt is retried with a new world
    When this attempt fails once before succeeding
    Then the second attempt uses a fresh world
