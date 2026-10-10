Feature: Application startup

  Scenario: Application mounts into the page
    Given a document with an application mount target
    When the application starts
    Then the application is mounted into the target

  Scenario: Application requires a mount target
    Given a document without an application mount target
    When the application starts
    Then startup fails with "Missing #app element"

  Scenario: Dates follow browser language and local time without shifting calendar dates
    Then displayed dates respect browser language and local time
