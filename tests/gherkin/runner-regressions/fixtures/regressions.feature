@runner-fixture
Feature: Qualified QuickPickle preserves cases and lifecycle
  Scenario Outline: Every Examples block and tag survives for <value>
    Given the example has value "<value>"
    Then its Examples tag is "<tag>"
    And its canonical Gherkin identity is recorded
    @first
    Examples: First block
      | value | tag    |
      | same  | @first |
      | same  | @first |
    @second
    Examples: Second block
      | value | tag     |
      | same  | @second |

  @init-fails
  Scenario: World initialization failure still runs After
    Then the unreachable body must not run

  @before-fails
  Scenario: Before failure still runs After
    Then the unreachable body must not run

  Scenario: Failed initialization and Before received one cleanup each
    Then both failed setup scenarios were cleaned exactly once

  Scenario: Cooperative timeout aborts and settles before cleanup
    When cancellable work exceeds the step deadline

  Scenario: Following cooperative timeout starts after settlement
    Then cooperative work settled before After and this scenario

  Scenario: Short uncooperative work is drained after its deadline
    When short uncooperative work exceeds the step deadline

  Scenario: Following scenario cannot overlap drained old work
    Then short uncooperative work finished before After and this scenario

  Scenario: Error details are retained for machine reporting
    Given a deliberately undefined patched-core step

  @after-fails
  Scenario: A failing After does not skip remaining cleanup
    Then the regular body succeeds

  Scenario: All After callbacks ran in reverse registration order
    Then throwing and remaining After hooks both ran before the outer cleanup

  @after-step-fails
  Scenario: A failing AfterStep does not skip remaining step cleanup
    Then the regular body succeeds

  Scenario: All AfterStep callbacks ran before scenario cleanup
    Then throwing and remaining AfterStep hooks ran before scenario After
