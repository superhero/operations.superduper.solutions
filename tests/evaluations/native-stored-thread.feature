@native-stored-thread
Feature: Actual SDK stored-thread persistence
  Scenario: Stored-thread reads use the actual native store without inference
    Then the pinned SDK reads its owned persisted thread history goals and attachments

  Scenario: Private stored-thread reads retain real history across SDK children
    Then the private vault reads all eight stored-thread methods through the actual SDK
