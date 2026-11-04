Feature: Compatible FP32 native decisions
  Scenario: Compatible decision profiles preserve native protocols and full artifact URLs
    Then compatible decisions retain seven pinned native heads and verified metadata sources
  Scenario: Compatible decisions prove GPU placement and reject overflow before scoring
    Then compatible D3 uses exact native inspection and packed GPU evidence without truncation
  Scenario: Decision cancellation retains the actual cleanup outcome
    Then compatible decision cancellation drains and failed cleanup remains failed
