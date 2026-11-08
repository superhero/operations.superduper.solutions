@native-turn-control
Feature: Owned active native turn controls
  Scenario: Turn controls preserve startup interruption and annotated text preconditions
    Then turn control inputs retain native IDs annotations and client message IDs
  Scenario: Turn controls identify invalid fields and UTF-8 ranges
    Then invalid turn controls name their offending parameters before dispatch
  Scenario: Steering acknowledges only the owned active turn and leaves its owner running
    Then owned steering retains its acknowledgement without completing the parent turn
  Scenario: Interruption keeps its owner until acknowledgement in either response order
    Then owned interruption drains native acknowledgements before the parent closes
  Scenario: Startup interruption keeps the native empty turn identifier
    Then startup interruption cancels only the owned pending thread
  Scenario: Foreign stale or idle control requests cannot take over native work
    Then turn controls reject unowned preconditions while preserving their owner
  Scenario: Authority changes and malformed acknowledgements withhold control results
    Then turn controls lose revoked authority and reject mismatched replies
  Scenario: Turn control models keep their real native result and notification schemas
    Then turn control operation models preserve typed native contracts
