# Colors

The interface uses five semantic color tokens. Components must reference these
tokens instead of introducing literal colors of their own:

```css
--color-background: #023047;
--color-surface: #219ebc;
--color-foreground: #8ecae6;
--color-accent: #ffb703;
--color-emphasis: #fb8500;
```

Their roles are:

- `background`: application canvas and darkest base;
- `surface`: panels, controls, and secondary UI areas;
- `foreground`: primary text and light structural elements;
- `accent`: interactive elements, selections, and primary actions;
- `emphasis`: stronger highlights and attention states.

A different theme should remap these same five semantic tokens rather than
renaming them. Derived shades should use these variables, for example with
`color-mix()`, instead of adding unrelated palette constants.
