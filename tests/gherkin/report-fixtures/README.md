# Report fixtures

## Purpose

`createReportFixture(directory, options)` runs a tiny authored Gherkin fixture
through the application's Vitest defaults and maintained QuickPickle package.
It creates genuine JSON, blobs, built-in HTML, attachment files and V8 coverage.
Equivalent immutable control runs are cached per worker; callers receive their
own copies for relocation and negative-input checks.

## Controls

Options select passing behavior, assertion failure or After-hook failure; named
suite projects; repeated outline rows; and HTML/coverage output. Source fixtures
include both executed and unexecuted files, colliding punctuation in filenames,
Unicode, and line anchors far enough down a page to test navigation.

`coverageThresholds: true` applies the real four-metric 100% gate to the deliberately
uncovered fixture. Its Gherkin cases pass while Vitest exits nonzero for coverage;
this verifies that passing scenarios cannot conceal a failed coverage gate.

Pure automation uses a PNG and empty ZIP to verify attachment rendering and
byte-preserving downloads. The ZIP is a download fixture, not a fabricated
Playwright trace. Browser cases pass actual screenshot and trace paths through
`attachments: { screenshotPath, tracePath }`; the helper copies their bytes and
keys its cache by their hashes. No nested browser is started by this helper.

## Evidence boundary

These small controls do not certify full application validation. Their merge
proof is explicitly diagnostic. Production proof, full case discovery, coverage
thresholds and release reuse must continue to reject partial or stale results.
Do not replace positive fixture output with hand-authored Vitest blobs.
