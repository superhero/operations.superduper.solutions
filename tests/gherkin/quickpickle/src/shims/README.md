# Upstream compatibility shims

## Runtime helpers

The path modules retain browser-safe normalization and sanitization for upstream
World helpers. `png.mjs` loads the appropriate Node/browser PNG implementation
for optional screenshot comparison.

## Types

`cucumber.d.mts` retains parameter-definition types without importing the legacy
Cucumber runner. These shims support the local QuickPickle package; application
utilities belong in the application's domain modules.
