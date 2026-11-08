@native-thread-content
Feature: Actual SDK thread content effects
  Scenario: All six content methods retain real attachment goal and history effects
    Then the pinned SDK stores attachments preserves goal provenance and reverts only conversation history

  Scenario: All six content methods complete through the paired encrypted broker
    Then the content broker stores typed data and preserves its loaded thread after revert

  Scenario: Active goal acknowledgement and background execution preserve paired ownership
    Then an explicitly active goal starts and clears through the real paired child without exposing its background turn
