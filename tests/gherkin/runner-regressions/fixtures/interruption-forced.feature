Feature: Forced interruption disposes a noncooperating worker
  Scenario: An active operation blocks its worker event loop
    When owned work blocks the worker event loop until it is terminated

  Scenario: Another World must never start after the blocked operation
    Then the unreachable body must not run
