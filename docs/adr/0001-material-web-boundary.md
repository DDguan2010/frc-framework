# ADR 0001: Material Web boundary

- Status: Accepted
- Date: 2026-07-17

## Context

FRC Framework requires Google's official Material Design 3 web implementation and a calm,
black/gray/white visual language. `@material/web` is the official component package, but its
repository currently describes the project as being in maintenance mode.

## Decision

Pin `@material/web` to an exact reviewed version. Import it only from
`src/renderer/ui/material/index.ts`. Application pages compose official `md-*` controls and Material
tokens. Layout-only containers such as the project tree, split workspace, and diff surface may use
semantic HTML and CSS, but must not become a competing control library.

Material Web 2.5.0 does not ship a Snackbar component. Non-blocking status messages therefore use
an accessible `aria-live` status surface composed from Material color/type tokens; confirmation and
blocking messages use the official `md-dialog`. This avoids importing or inventing a second control
implementation only to imitate a missing component.

## Consequences

The renderer remains visually consistent and complies with the product requirement. The narrow
import boundary makes a future official successor replaceable without coupling the domain and page
models to individual Material Web module paths.
