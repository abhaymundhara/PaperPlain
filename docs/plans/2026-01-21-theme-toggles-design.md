# Theme Toggles Design

## Goal
Add persistent light/dark and warm mode toggles in the header, always visible regardless of auth state.

## UX Behavior
- Two icon buttons live beside the auth controls in the header.
- Theme toggle switches light and dark mode.
- Warm toggle adds a warm tint to either light or dark mode.
- Toggles show active state and update tooltip/aria labels.
- User choices persist via localStorage and restore on reload.

## Structure
- Buttons live inside a new `.theme-controls` container in the header.
- `<html>` receives `data-theme="light|dark"` and `data-warm="on|off"` attributes.

## Data Flow
- On `DOMContentLoaded`, read `paperplain-theme` and `paperplain-warm` from localStorage.
- Apply attributes to `<html>` and update button states.
- On toggle, update attributes, button state, and localStorage.

## Styling
- Theme overrides are applied by CSS variable updates on `html[data-theme]`.
- Warm overrides are layered with `html[data-warm="on"]` for each theme.
- Button styling uses a small circular control with active state styling.

## Error Handling
- Storage access is guarded to avoid errors in restricted environments.
- Toggle functions no-op if buttons are missing.

## Testing
- Static HTML test asserts both toggle buttons exist.
