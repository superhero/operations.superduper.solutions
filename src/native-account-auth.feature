@native-account-auth
Feature: Public native account authentication contracts
  Scenario: Public sign-in inputs retain browser options and saved key references
    Then account authentication inputs preserve public modes and private key references
  Scenario: Account authentication rejects internal modes and unrelated option fields
    Then account authentication inputs name invalid modes keys and browser options
  Scenario: Workflow authentication confirms account changes without publishing its saved key
    Then workflow key sign-in and logout update only their confirmed encrypted pairing
  Scenario: Workflow browser and device sign-in wait for the matching completion
    Then workflow public browser and device sign-in keep instructions transient until confirmation
  Scenario: Cancellation controls only the owned workflow sign-in
    Then workflow cancellation rejects foreign IDs and completes only its owned pending attempt
  Scenario: Authentication grants do not imply agent authority
    Then authentication workflows require their independent grant and reject agent escalation
  Scenario: Account authentication models retain acknowledgement and confirmation contracts
    Then authentication models preserve their wire declarations and portable confirmation ports
  Scenario: Pending authentication loses authority without saving a late account
    Then workflow sign-in rejects source identity lock and cancellation changes without adopting a profile
  Scenario: Native authentication credentials cannot escape through account metadata
    Then authentication confirmation withholds raw and encoded native credential echoes
