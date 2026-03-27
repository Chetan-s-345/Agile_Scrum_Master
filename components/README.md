# Shared Components (components)

This folder contains reusable UI and dashboard shell components used across app routes.

## Notable Components
- sidebar.tsx: workspace navigation, spaces, and shortcuts.
- navbar.tsx / home-navbar.tsx: authenticated/public navigation surfaces.
- TaskDetailDrawer.tsx: task detail and action workflow panel.
- Agent and integration panels: operational visibility widgets.

## Conventions
- Keep route/data logic outside components where possible.
- Use stores for cross-page UI state (theme, sidebar, agent feed).
- Prefer composable props over tightly coupled imports.

## Theming
- Respect global theme state and avoid hardcoded behavior that breaks dark/light mode parity.
