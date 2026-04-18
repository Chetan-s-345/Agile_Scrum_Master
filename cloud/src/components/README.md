# Shared Components (src/components)

This folder currently includes feature UI like AgentBubble.

## Component Guidelines
- Keep components presentational where possible.
- Read/write global state through stores instead of duplicating side effects.
- Favor explicit props for behavior and isolate async effects in hooks.

## Theming
- Follow existing theme conventions and avoid introducing hard-coded visual state that conflicts with dark/light mode behavior.
