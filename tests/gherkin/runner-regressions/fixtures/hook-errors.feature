Feature: All failures remain visible while weighted cleanup continues
  @body-cleanup-fails
  Scenario: A body failure and two cleanup failures remain visible
    When the fixture body fails with a cause

  Scenario: A later body still executes before suite cleanup fails
    Then the second fixture body succeeds
