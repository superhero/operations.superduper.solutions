Feature: Assistant integration boundaries
  Scenario: Native token accounting remains owned by the native engine
    Then native assistant turns bypass estimates without trimming the request
  Scenario: Installed Bonsai loading uses its selected reader and fails clearly
    Then Bonsai loaders preserve their reader and reject unavailable native adapters
  Scenario: Native completion and stream failures are drained together
    Then concurrent native stream failures reset safely before retry
  Scenario: Image preflight checks original and compatible device boundaries
    Then vision preflight rejects missing capabilities and missing device limits
  Scenario: Compatible decisions do not substitute a missing GPU
    Then compatible Strands rejects absent GPU support with the host Wasm implementation
  Scenario: Catalog identities reject malformed publication metadata
    Then installed catalogs reject invalid file and publication part pins
  Scenario: Model notifications stay lazy and release unused channels
    Then model notifications preserve listeners across optional channel lifetimes
  Scenario: Installed readers preserve native URL request shapes
    Then installed asset routing handles URL and Request objects without remote fallback
  Scenario: Continuous speech cannot use the legacy download route
    Then continuous speech rejects the legacy asset loader before fetching
