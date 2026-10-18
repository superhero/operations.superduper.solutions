# Disposable runner controls

## Gherkin inputs

These features exercise the maintained runner itself. Some deliberately fail,
skip, time out or receive OS signals. Their exact results are asserted by the
passing outer cases in `../contracts.feature`; keep them out of ordinary suite
discovery.

## Registration

`vitest.config.mjs` selects one control mode. `setup.mjs` uses the externalized
native loader so repeated setup does not register steps twice. Keep the local
QuickPickle folder externalized too, sharing one registry with generated cases.

## Resource evidence

Step modules write durable event ledgers. The named worker fixture owns an HTTP
server with cleanup registered before startup. Cancellation controls require
explicit scenario and worker cleanup, closed ports and a dead worker PID; an
interrupted run never supplies successful validation evidence.
