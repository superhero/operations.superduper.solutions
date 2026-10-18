Feature: Interruptions abort work and close resources before worker disposal
  Scenario: An external interruption cancels an active operation
    When owned work waits for an external interruption
