@automation
Feature: Incremental CI retains only independently verified feature results
  Scenario: Complete feature units preserve native results and current inventory
    Given a hermetic CI feature-unit execution
    Then its browser aggregate includes all eleven cases and their original steps

  Scenario: An isolated step correction invalidates only its nine cases
    Given a hermetic CI feature-unit execution
    When only the keybindings step implementation changes
    Then only the nine keybindings cases need fresh execution

  Scenario: Adding a feature retains keys for existing features
    Given a hermetic CI feature-unit execution
    When another feature uses an existing step
    Then existing feature keys are unchanged and the new case is required

  Scenario: A shared helper invalidates each actual dependent
    Given a hermetic CI feature-unit execution
    When the shared CI fixture helper changes
    Then every dependent feature needs fresh execution

  Scenario Outline: Invalid evidence cannot become a passing aggregate
    Given a hermetic CI feature-unit execution
    When its unit evidence has "<defect>"
    Then the unit result is rejected
    Examples:
      | defect                  |
      | missing receipt         |
      | incomplete receipt      |
      | wrong input digest      |
      | wrong pull request      |
      | wrong repository        |
      | untrusted workflow      |
      | stale execution         |
      | renewed receipt time    |
      | changed result bytes    |
      | changed blob bytes      |
      | changed attachment      |
      | unexpected file         |
      | wrong original attempt  |
      | wrong original revision |
      | symlink output          |

  Scenario: A teardown failure cannot publish a successful unit
    Given a hermetic CI feature-unit execution
    When a unit cleanup hook throws after its assertions pass
    Then the unit process fails and creates no reusable receipt

  Scenario: Aggregation rejects missing and duplicate feature results
    Given a hermetic CI feature-unit execution
    Then missing and duplicate unit inventories cannot certify validation

  Scenario: Failed workflow results can resume in another attempt of the same PR
    Given a hermetic CI feature-unit execution
    Then valid previous-attempt results remain reusable with their original provenance

  Scenario: A stale or invalid download falls back to execution
    Given a hermetic CI feature-unit execution
    Then a rejected cached artifact is a cache miss and never overwrites valid evidence

  Scenario Outline: The installed SDK verifies the complete artifact archive digest
    Then the installed artifact SDK verifies a checkpoint with a "<kind>" archive digest
    Examples:
      | kind       |
      | matching   |
      | mismatched |

  Scenario: GitHub commit associations identify the PR when run metadata is empty
    Given a hermetic CI feature-unit execution
    Then passing units from a failed same-PR workflow are found through commit association

  Scenario: Another PR cannot supply a reusable result through a matching branch
    Given a hermetic CI feature-unit execution
    Then mismatched commit association supplies no cached result

  Scenario: Fully cached validation starts no browser runner batches
    Given a hermetic CI feature-unit execution
    Then cache planning leaves all cases verified and schedules no browser batches

  Scenario: Changed PR inputs stop obsolete validation before browser startup
    Given a hermetic CI feature-unit execution
    Then an obsolete prepared input set starts no browser container

  Scenario: Managed changelog updates retain equivalent source inputs
    Given a hermetic CI feature-unit execution
    Then root tree comparison accepts only the unchanged execution inputs

  Scenario: A host batch publishes a sealed result and removes its owned container
    Given a hermetic CI feature-unit execution
    Then the browser controller publishes completed evidence and closes its container

  Scenario: Whole-profile inventory changes do not discard browser feature results
    Given a hermetic CI feature-unit execution
    Then adding a source case retains every existing browser input key

  Scenario: Diagnostic capture remains available with lighter ordinary traces
    Then CI capture keeps ordinary action traces and full diagnostic contracts

  Scenario: Native incremental reporting retains every profile and original unit
    Given native feature units and five whole profiles with complete coverage
    When the incremental native report is merged
    Then all original cases and attachments survive with verifiable publication evidence

  Scenario: Changed unit evidence cannot certify an incremental report
    Given native feature units and five whole profiles with complete coverage
    When an original unit attachment is changed before report generation
    Then incremental certification fails and removes stale output

  Scenario: Application input changes invalidate all browser feature results
    Given a hermetic CI feature-unit execution
    Then an application source correction invalidates all browser feature keys

  Scenario: Cancellation closes owned browser resources without publishing a pass
    Given a hermetic CI feature-unit execution
    Then cancelling an active batch closes its container and retains only diagnostics

  Scenario: A feature failure retains independent successful checkpoints
    Given a hermetic CI feature-unit execution
    Then a failed feature does not discard a successful sibling checkpoint

  Scenario: Missing results retain available native cases for diagnostics
    Given a hermetic CI feature-unit execution
    Then an incomplete browser inventory stages available evidence without certifying it

  Scenario: Fresh-only features cannot reuse a previous workflow run
    Given a hermetic CI feature-unit execution
    Then a fresh-only feature rejects old-run receipts before download

  Scenario: Unknown eager side effects invalidate every dependent execution
    Given a hermetic CI feature-unit execution
    Then an eager nested initialization cannot remain a local-only input
