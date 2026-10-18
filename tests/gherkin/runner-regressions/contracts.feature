Feature: Gherkin runner preserves cases, diagnostics and resource ownership
  Scenario: Feature and Rule backgrounds retain their order and inherited tags
    Then the positive runner fixtures pass all seven cases
    And their feature hooks each run once

  Scenario: Independent Worlds retain DataTables, typed docstrings and mutations
    Then each positive fixture scenario initializes a fresh World
    And DataTables and JSON docstrings retain their values

  Scenario: Every Examples block preserves independent identical rows
    Then all three outline rows have distinct canonical identities
    And their inherited Examples tags are preserved

  Scenario: Cucumber boolean tag expressions select only matching examples
    Then selecting the second Examples block runs exactly one matching case

  Scenario: Initialization and Before failures receive exactly one cleanup
    Then failed setup is reported without executing its unreachable body
    And both failed setup scenarios receive one After callback

  Scenario: Cooperative timeout aborts and settles before cleanup
    Then the timed-out cooperative step reports its deadline
    And its work settles before After and the following case

  Scenario: Short uncooperative work is drained before another case
    Then the short uncooperative step reports its deadline
    And its work finishes before After and the following case

  Scenario: Undefined steps retain their message, stack and Gherkin step details
    Then the undefined step has its complete diagnostic in the machine report
    And its failed step metadata retains the same error

  Scenario: A throwing After does not skip remaining cleanup
    Then After callbacks unwind in reverse registration order despite a failure

  Scenario: A throwing AfterStep does not skip remaining step cleanup
    Then all AfterStep callbacks finish before scenario After despite a failure

  Scenario: Retries initialize and clean a separate World for each attempt
    Then the retry fixture passes on its second attempt
    And both attempts have different Worlds and receive cleanup

  Scenario: Noncooperating work quarantines the worker before another World starts
    Then the noncooperating step exceeds its bounded grace
    And the following case fails before World construction or its body

  Scenario: Hook failures preserve exact expected machine outcomes
    Then the contract fixtures report eight passed cases and seven intended failures

  Scenario: Metadata and source maps retain the original feature identity
    Then every fixture result exposes its relative feature and example location
    And transformed features carry their original source map

  Scenario: Generated callbacks retain extended Vitest worker fixtures across files
    Then both extended-test fixture cases pass
    And one owned worker resource starts and stops around both features

  Scenario: Skipped and TODO cases preserve identities and distinct machine totals
    Then skipped and TODO controls retain canonical metadata without executing their bodies

  Scenario: Simultaneous body and cleanup failures retain every message and stack
    Then the failing body and both failing After callbacks remain visible in JSON

  Scenario: Explicit hook weights preserve order and equal-weight cleanup unwinds
    Then weighted hooks run in their declared order despite cleanup failures

  Scenario: AfterAll failures cannot prevent later suite cleanup
    Then both AfterAll failures remain visible and every suite cleanup runs

  Scenario: Cyclic error graphs retain native references without recursive formatting
    Then nested cyclic failures have bounded readable diagnostics

  Scenario Outline: Interruptions cancel owned work and close resources before the fork exits
    Then external "<signal>" aborts the operation and explicitly cleans owned resources before disposal

    Examples:
      | signal  |
      | SIGINT  |
      | SIGTERM |

  Scenario: Forced interruption disposes a worker that cannot process cancellation
    Then forced interruption terminates the blocked worker and closes its owned ports
