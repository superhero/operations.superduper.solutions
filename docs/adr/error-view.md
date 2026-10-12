# Error reporting

> [!IMPORTANT]
> Errors are reported with full transparency through both the user interface and console.

## Console diagnostics

Pail provides shared logging with severity and feature scopes for the application,
development server, scripts and tests. Native errors retain their stacks, codes
and cause chains; Inspector supplies snapshots for other values. Missing stacks
are not invented. Logs exclude workflow content and credentials, and
machine-readable output remains unformatted.

## Development errors

Visulima presents themed source details and a cause tree of error types and
codes. Cause navigation stays separate from the history of unrelated failures.

Application errors reach the overlay through the shared logger. Console
forwarding is disabled to prevent reporting loops; original errors and transport
failures remain in the console. Uncaught exceptions and unhandled rejections
still reach the overlay.

## Recovery

Settings errors identify failed opens, reads or saves and explain recovery.
Development reports after rendering; production shows a descriptive startup
alert. Storage failures release the loader and leave **Settings → Browser →
Retry saved settings** available.

## Developer tools

The toolbar is opt-in through **Settings → Developer**, independently of the
overlay. Both follow the application's palette and are excluded from production.
Dependency upgrades require verification of error navigation and theme adapters.
