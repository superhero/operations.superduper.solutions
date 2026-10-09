Feature: Standalone coverage report
  Coverage navigation must work without separately hosted pages or assets.

  Scenario Outline: Coverage navigation works over <transport>
    Given a standalone coverage report opened over "<transport>"
    When I navigate coverage folders, files, source lines and browser history
    Then coverage navigation needs no separate pages or network assets

    Examples:
      | transport |
      | http      |
      | file      |
