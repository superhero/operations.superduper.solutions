Feature: Compatible Strands decision runtime
  Scenario: Strands conversion files retain their exact immutable identities
    Then compatible Strands preserves the original pointer head and complete converted file pins
  Scenario: Strands disposal waits for the child runtime
    Then Strands native RPC preserves results and awaits the actual disposal outcome
