@native-turn-control
Feature: Actual SDK owned turn control
  Scenario: The actual SDK steers a held owned turn and retains its active ID
    Then the actual SDK steering preserves its owner and queued instruction
  Scenario: The actual SDK acknowledges interruption before the owner is retired
    Then the actual SDK interruption completes through the private workflow broker
