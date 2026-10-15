@startup-modules
Feature: Development module loading recovery
  A stale development module must not leave startup stuck or reload indefinitely.

  Scenario: A transient module fetch failure recovers automatically
    Given the development application module fails once with an outdated dependency response
    Then the development application finishes loading after one automatic retry

  Scenario: Persistent module fetch failures offer a bounded manual recovery
    Given the development application module keeps failing with an outdated dependency response
    Then startup offers Reload after exactly one automatic retry
    When the application module becomes available and I reload startup
    Then the development application finishes loading with its retry guard cleared

  Scenario: A module execution error remains visible without automatic reload
    Given the development application module throws a runtime error
    Then startup shows the original runtime error without automatically reloading
    When the application module becomes available and I reload startup
    Then the development application finishes loading with its retry guard cleared
