@native-plugin-share
Feature: Actual SDK plugin sharing effects
  Scenario: Native plugin sharing publishes archives updates permissions and deletes its association
    Then the actual SDK uploads owned plugin archives changes native share permissions and deletes only its mapping
  Scenario: Native plugin sharing checks out HTTPS bundles and keeps existing edits
    Then the actual SDK checks out a verified HTTPS share into its personal marketplace and preserves repeated local edits
  Scenario: Failed native share uploads cannot finalize publication
    Then failed native plugin uploads do not finalize publication or create local share mappings
  Scenario: Paired plugin sharing confirms publishing access and removal effects
    Then actual plugin sharing effects advance exact encrypted ownership across publishing access and deletion
  Scenario: Paired plugin checkout preserves edited personal sources and later publication
    Then actual paired checkout keeps personal edits and permits publishing only its reviewed package
  Scenario: Unverified plugin share mutations cannot update encrypted pairing
    Then unverified share files associations access receipts and cancellation cannot advance pairing
  Scenario: Private sources credentials and denied native share effects cannot update ownership
    Then share source credentials private paths native upload failure and denied permissions never publish verified ownership
