@runner-fixture
Feature: Unsettled timed-out work quarantines subsequent cases
  Scenario: Work that ignores abort exceeds the bounded grace
    When uncooperative work never settles

  Scenario: A subsequent case is rejected before its World starts
    Then the unreachable body must not run
