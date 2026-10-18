@runner-fixture @positive @second-feature
Feature: Independent feature lifecycle
  Scenario: A second file gets its own feature hooks
    Then the feature hook ran exactly once for this file
    And this world has no previous scenario mutations
