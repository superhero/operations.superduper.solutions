@native-turn-work
Feature: Actual SDK owned review and compaction
  Scenario Outline: The private workflow broker reviews the <target> target
    Then the actual SDK workflow reviews the "<target>" target on its owned thread
    Examples:
      | target             |
      | uncommittedChanges |
      | baseBranch         |
      | commit             |
      | custom             |
  Scenario: The private workflow broker waits for compaction completion
    Then the actual SDK compaction workflow waits for its owned terminal event
  Scenario: Deprecated detached review remains unavailable on native paginated threads
    Then the actual SDK rejects detached review on paginated threads
  Scenario: An owned inline review can be stopped through the private workflow broker
    Then the actual SDK inline review retains owned interruption
