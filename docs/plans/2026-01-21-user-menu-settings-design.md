# User Menu and Settings Modal Design

## Goal
Show only a user avatar after sign in, with a click-only dropdown that exposes Settings and Sign out. Settings opens a small modal styled like the sign-in modal.

## UX Behavior
- Signed out: show the "Sign in" button that opens the Google-only auth modal.
- Signed in: hide the sign-in button and show a circular avatar with initials (first + last name initial, fallback to email).
- Clicking the avatar toggles a dropdown menu anchored under it.
- Dropdown items:
  - Settings (opens the settings modal and closes dropdown).
  - Sign out (executes sign out and closes dropdown).
- Dropdown closes on outside click or Escape.
- Settings modal uses the same overlay + modal styling as the auth modal, with a close button.

## Structure
- Header contains a sign-in button and a hidden user menu container.
- User menu contains:
  - Avatar button with initials.
  - Dropdown panel with Settings and Sign out buttons.
- Settings modal is a separate overlay with a modal content wrapper.

## Data Flow
- `refreshSession()` drives visibility and initials based on `/api/auth/me`.
- Initials are derived from the user name or email.
- `toggleUserMenu()` controls dropdown visibility and aria-expanded.
- `openSettingsModal()` shows the modal and closes the dropdown.
- `handleSignOut()` calls the existing sign-out flow.

## Error Handling
- Dropdown and modal toggles are no-ops if expected elements are missing.
- Auth errors reuse the existing inline auth error display.

## Testing
- HTML structure checks for user menu IDs and settings modal presence.
- Google-only auth modal test remains unchanged.
