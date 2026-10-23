Feature: Production build

  Scenario: Build produces an embedded application with optional speech resources
    Given the production build has completed
    Then the dist directory contains the application hosting files and optional speech resources
    And the hosting headers enable cross-origin isolation
    And optional speech resources preserve runtime isolation and license notices

  Scenario: Production page exposes operations and the workflow editor
    Given the production build has completed
    Then the production page contains the application title
    And the production page contains the workflow canvas
    And the production page contains the operation catalog and execution results
    And the production page contains the separate example catalogs

  Scenario: JavaScript is embedded in the production page
    Given the production build has completed
    Then the production page contains inline JavaScript
    And the production page has no external JavaScript source

  Scenario: CSS is embedded in the production page
    Given the production build has completed
    Then the production page contains inline CSS
    And the production page has no external stylesheet

  Scenario: Embedded vault dependency retains its distribution notices
    Given the production build has completed
    Then the production page contains the vault cryptography license notices

  Scenario: Embedded Pi dependencies retain their distribution notices
    Given the production build has completed
    Then the production page contains the Pi assistant license notices
