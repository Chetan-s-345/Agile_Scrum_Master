# Zustand Stores

This folder holds shared client-side stores.

## Current Stores
- agentStore.js:
  - Manages agent statuses, approval queue, action feed, polling, and Socket.IO updates.

Additional shared stores currently live in lib/:
- lib/theme-store.ts
- lib/ui-store.ts

## How Stores Connect
- Agent UI consumes agentStore state and refresh actions.
- Layout/navbar consume ui-store and theme-store to keep shell behavior consistent.

## Testing Notes
For non-React usage, import store hooks and call getState()/setState() in tests to assert transitions.
