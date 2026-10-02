# Colors

The interface uses five semantic color tokens:

- `--color-background`: application canvas and base background;
- `--color-surface`: panels, controls, and secondary UI;
- `--color-foreground`: text and structural foreground elements;
- `--color-accent`: interactive elements, selections, and primary actions;
- `--color-emphasis`: stronger highlights and attention states.

Themes define the values of these tokens. Components must use the semantic
tokens rather than hard-coded palette values.

Derived shades should use the same variables, for example with
`color-mix()`, instead of introducing additional palette constants.
