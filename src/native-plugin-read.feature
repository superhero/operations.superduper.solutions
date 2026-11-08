@native-plugin-read
Feature: Paired plugin catalog reads
  Scenario: Plugin read models retain wire contracts typed ports and field diagnostics
    Then plugin read models retain wire contracts typed ports and field diagnostics
  Scenario: Five plugin reads share one paired session without agent or write authority
    Then five plugin reads share one paired session without agent or write authority
  Scenario: The plugin read grant cannot enable an agent or bypass source boundaries
    Then plugin reads reject missing grants workspace escapes and indirect source escapes
  Scenario: Plugin reads reject malformed results and native or encrypted credential echoes
    Then plugin read results reject malformed data and native or vault credential echoes
  Scenario: Revoking pending plugin reads closes their owned attempt without replay
    Then pending plugin reads reject cancellation lock identity and schema changes without replay
  Scenario: Local plugin source changes invalidate pending reads
    Then a plugin source changed before response cannot publish stale metadata
