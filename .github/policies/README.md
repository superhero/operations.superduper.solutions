# Repository policy inputs

Store declarative repository-administration payloads here. These files describe
settings applied through GitHub's API; committing a payload does not apply the
setting to the live repository.

## Event allowance

[`documentation-events.json`](documentation-events.json) scopes the
`pull_request_target` event allowance to `.github/workflows/ci-docs.yml`. Its
consumer is the administrator procedure in the
[workflow guide](../workflows/README.md#enabling-the-documentation-workflow).
That guide explains initial setup and updating an existing policy.

## Placement and application

Keep workflow triggers, permissions and jobs in
[`../workflows/`](../workflows/README.md), executable checks in
[`../scripts/`](../scripts/README.md), and policy assertions in
[`../tests/`](../tests/README.md). A new payload should identify its consumer and
application procedure so contributors can distinguish intended configuration
from verified live state. Keep credentials out of policy files.

## Policy changes

Changes to the documentation event boundary should stay aligned with its
automation scenarios and the
[documentation integration decision](../../docs/adr/continuous-integration.md#updating-documentation).
