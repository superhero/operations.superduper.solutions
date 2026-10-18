Feature: Skipped and TODO cases retain their declared identity
  Scenario: A runnable control executes
    Then the body executes successfully

  @skip
  Scenario: A skipped control does not execute its body
    Then a skipped body must never execute

  @todo
  Scenario: A TODO control does not execute its body
    Then a TODO body must never execute
