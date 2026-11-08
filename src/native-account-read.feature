@native-account-read
Feature: Bounded public account reads
  Scenario: Account read inputs preserve usage queries without claiming unsupported fallback
    Then account read inputs preserve nullable thread queries and reject unsupported client claims
  Scenario: Account read models preserve wire contracts and portable typed fields
    Then account read models expose portable typed fields and exact wire results
  Scenario: Account reads require their grant and the correct account type
    Then account reads reject missing grants and anonymous or API key backend access
  Scenario: Account results reject foreign identities and invalid structures
    Then account read results reject foreign accounts threads and malformed messages
  Scenario: Pending account reads revoke without publishing stale results
    Then pending account reads reject source identity lock and cancellation changes
