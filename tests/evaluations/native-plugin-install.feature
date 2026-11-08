@native-plugin-install
Feature: Actual SDK plugin installation and reconciliation
  Scenario: Plugin install reconcile and uninstall preserve local and verified HTTPS bundle effects
    Then the actual SDK installs local and HTTPS remote plugins reconciles real bundles and uninstalls their owned state
  Scenario: Owner supplied CA trust preserves native bundle hostname verification
    Then native HTTPS bundle downloads reject a trusted certificate for the wrong host
  Scenario: Real plugin management effects advance only the current encrypted pairing
    Then actual SDK plugin effects update encrypted pairing across local remote and repeated reconciliation calls
  Scenario: Unverified plugin changes cannot publish an encrypted authority update
    Then unverified plugin effects cancellation source changes and receipt substitution never advance pairing
  Scenario: Listed workspace plugin hooks retain native trust effects and remote identity
    Then the actual SDK reconciles listed workspace hooks with only its discovered trust hash changes
