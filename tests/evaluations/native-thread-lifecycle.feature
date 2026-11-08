@native-thread-lifecycle
Feature: Actual SDK stored-thread lifecycle effects
  Scenario: All eight native thread lifecycle methods retain real storage effects
    Then the pinned SDK renames moves forks unsubscribes archives restores and deletes owned threads

  Scenario: Native archive and delete use the same verified persisted subtree
    Then native thread tree inspection covers the actual SDK archive and delete cascade

  Scenario: A native descendant outside the paired workspace prevents subtree mutation
    Then native thread tree inspection withholds archive and delete for a foreign real descendant

  Scenario: All eight lifecycle methods complete through the encrypted paired workflow broker
    Then the pinned lifecycle methods pass the paired encrypted workflow broker without inference
