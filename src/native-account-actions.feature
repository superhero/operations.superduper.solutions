@native-account-actions
Feature: Explicitly approved native account actions
  Scenario: Action inputs retain opaque reset IDs and credit type enums
    Then account action inputs preserve native reset and email semantics
  Scenario: Invalid action fields name the offending parameter
    Then account action input validation identifies invalid and unsupported fields
  Scenario: Each native account action waits for its exact human approval
    Then account actions publish only their approved native outcomes
  Scenario: Declined foreign and replayed approvals never dispatch an action
    Then account action approval tokens are owned single use and optional to decline
  Scenario: Changed source account and runtime authority revoke pending approvals
    Then account action approvals lose changed authority before dispatch
  Scenario: Late action completion cannot bypass native identity checks
    Then changed native authority withholds a dispatched action result
  Scenario: Account action grants do not enable agent methods
    Then account actions require their independent grant and reject agent escalation
  Scenario: Native action metadata and results cannot publish credentials
    Then account actions withhold private metadata and malformed native replies
  Scenario: Account action models retain exact native result and input contracts
    Then account action models preserve typed wire declarations and named fields
  Scenario: General workflow access cannot bypass separately scoped account controls
    Then the general agent scope cannot dispatch gateway or billing actions

  Scenario: Private account approval frames retain their exact active owner
    Then private account approvals bind their exact method input identity and active request

  Scenario: Private account replies retain signal and post-guard authority
    Then private account reply capabilities retain signal identity and post-guard cancellation

  Scenario: Unapproved or closed account results cannot publish public success
    Then private account results require an approved live owner even without a progress subscriber

  Scenario: A superseded account response preserves the current approval owner
    Then a superseded account action response cannot clear the current approval owner
