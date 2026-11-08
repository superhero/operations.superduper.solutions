@native-stored-thread
Feature: Bounded owned stored-thread reads
  Scenario: Stored-thread read inputs preserve the native pagination and filter shapes
    Then stored-thread inputs retain all eight read contracts and their nullable filters

  Scenario: Stored-thread read inputs identify invalid and unbounded fields
    Then stored-thread inputs reject named bad cursors filters pages and thread IDs

  Scenario: Stored-thread read models retain typed results and precise UI inputs
    Then stored-thread models roundtrip their graphs and identify offending fields

  Scenario: Stored-thread reads do not require account sign-in or agent authority
    Then all eight stored-thread reads share the independently granted paired child

  Scenario: Stored-thread reads enforce separate grants and workspace ownership
    Then stored-thread reads reject missing grants escapes and execution escalation

  Scenario: Stored-thread results are typed bounded and private
    Then stored-thread reads withhold foreign results oversized pages and encoded credentials

  Scenario: Pending stored-thread reads cannot survive revoked authority
    Then pending stored-thread reads reject cancellation source changes and changed identities

  Scenario: Native experimental thread metadata retains a closed typed contract
    Then stored-thread schemas retain reviewed native extensions and reject unknown implementation data
