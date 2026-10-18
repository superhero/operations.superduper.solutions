// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Before, After, AfterAll, When, Then } from 'quickpickle';
const ledger = join(process.env.OPERATIONS_RUNNER_FIXTURE_OUTPUT, 'ledger.ndjson');
const record = (kind, world) => appendFileSync(ledger, `${JSON.stringify({ kind, scenario: world.info.scenario })}\n`);

Before({ weight: 10 }, world => record('before-10-first', world));
Before({ weight: 10 }, world => record('before-10-second', world));
Before({ weight: -10 }, world => record('before-minus-10', world));

After({ tags: '@body-cleanup-fails', weight: 10 }, world => record('after-10', world));
After({ tags: '@body-cleanup-fails', weight: 0 }, world => {
  record('after-0-first', world); throw new Error('EXPECTED_CLEANUP_A');
});
After({ tags: '@body-cleanup-fails', weight: 0 }, world => {
  record('after-0-second', world); throw new Error('EXPECTED_CLEANUP_B');
});
After({ tags: '@body-cleanup-fails', weight: -10 }, world => record('after-minus-10', world));

AfterAll({ weight: 10 }, world => record('suite-after-10', world));
AfterAll({ weight: 0 }, world => {
  record('suite-after-0-first', world); throw new Error('EXPECTED_AFTERALL_A');
});
AfterAll({ weight: 0 }, world => {
  record('suite-after-0-second', world); throw new Error('EXPECTED_AFTERALL_B');
});
AfterAll({ weight: -10 }, world => record('suite-after-minus-10', world));

When('the fixture body fails with a cause', world => {
  record('body-failed', world);
  throw new Error('EXPECTED_BODY_FAILURE', { cause: new Error('EXPECTED_BODY_CAUSE') });
});
Then('the second fixture body succeeds', world => record('body-passed', world));
