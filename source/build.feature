Feature: Production build

  Scenario: Build produces a single self-contained HTML page
    Given the production build has completed
    Then the dist directory contains only "index.html"
    And the production page contains the application title
    And the production page contains inline JavaScript
