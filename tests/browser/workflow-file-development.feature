@file-worker-development
Feature: File workers in the development server
  Production bundles alone cannot verify development module loading.

  Scenario: Development workers load and parse files without a warmed application
    Given a cold development file parser with 0 failed worker starts
    When I parse JSON and CSV through the development worker
    Then the development worker returns typed data and corrected CSV options
    And exactly 3 file workers were started
    And an aborted file parse does not start another worker
    And malformed file data is rejected without restarting the worker

  Scenario: One failed development worker start recovers without re-uploading
    Given a cold development file parser with 1 failed worker starts
    When I parse JSON and CSV through the development worker
    Then the development worker returns typed data and corrected CSV options
    And exactly 4 file workers were started

  Scenario: Persistent worker failures stop retrying and a later upload can recover
    Given a cold development file parser with 100 failed worker starts
    When I attempt a development file upload
    Then the upload reports a worker failure after its bounded retry
    When development worker loading becomes available
    And I parse JSON and CSV through the development worker
    Then the development worker returns typed data and corrected CSV options
    And exactly 5 file workers were started

  Scenario: The visible upload node recovers from a failed development worker start
    Given a cold development file parser with 1 failed worker starts
    When I upload a CSV through the visible development file node
    Then exactly 2 file workers were started
