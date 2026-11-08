@native-plugin-read
Feature: Actual SDK plugin reads
  Scenario: Five plugin reads preserve the pinned SDK local and authenticated remote contracts
    Then the pinned SDK lists local and remote plugins and reads owned plugin skills and shares
  Scenario: Five plugin reads complete through the private encrypted broker
    Then five actual SDK plugin reads complete through the paired encrypted broker
  Scenario: Authenticated remote skill responses cannot publish native credentials
    Then actual SDK plugin skill credentials remain private before browser delivery
