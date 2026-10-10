Feature: Production build

  Scenario: Build produces a single deployment artifact
    Given the production build has completed
    Then the dist directory contains only "index.html"

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
