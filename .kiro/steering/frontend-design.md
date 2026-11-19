# Frontend design

Rules for everything in `web/`. They summarize the Doctor7 design brief. They
are rules, not copies of any file.

## Mode

The interface is a work tool (Operate mode). People scan it fast, so it favors
consistency and familiar patterns. The brand shows in details, not in
decoration. There is one design intent. The brief wins over habit.

## Color tokens (Doctor7 theme)

Define every color once as a CSS variable in `web/src/styles/tokens.css`. Use
colors only through those variables.

| Token role | Value |
| --- | --- |
| Headings | `#5E60CE` |
| Main gradient | `#7400b8` at 33% to `#33bfe9` at 100%, 49 degrees |
| Secondary gradient | `#7f45d9` |
| Button gradient | `#8161f3` to `#4da4ff` |
| Primary, primary border, secondary | `#7400b8`, `#bca5eb`, `#9278c5` |
| Stat card pairs | `#fe69a5`/`#ff875e`, `#5e72e4`/`#8e70ee`, `#119bd2`/`#3ad0bf`, `#8362f7`/`#ee70e9` |
| "Now" marker | `#7a5cff` |

Accent color marks primary actions, selection, and state. It is not decoration.
Some brief colors cannot carry text at 4.5:1 (the button gradient and the middle
stat pairs). Use those only on surfaces without text, or behind icons that need 3:1.

## Type

- Lato for body text, Montserrat for headings (weights 400 to 800).
- Both are self-hosted with `@fontsource` (latin subsets). No Google Fonts and
  no request to any external server.
- Fixed rem scale, ratio 1.2. Running text is 65 to 75 characters wide.
- No system font as the heading voice.

## Quality rules (each one is tested or reviewed)

- Contrast: normal text 4.5:1, large text 3:1. On colored surfaces, secondary
  text is tinted toward that color, not gray.
- Interactive components have all states: normal, hover, visible focus, active,
  disabled, loading, error.
- Every screen has: loading (skeleton, not a centered spinner), empty (teaches
  what to do), error, and no-permission.
- Responsive from 360 px by structure: collapse navigation, stack tables. No
  fluid type. Touch targets are at least 44 px.
- Shadows use offset and soft blur. Corners are moderately rounded.
- Forbidden: hard offset shadows, gradient text, decorative glass or blur, a
  colored side border wider than 1 px on cards or alerts, emoji or Unicode
  glyphs as icons, nested cards, small labels above headings, section
  numbering, modals for tasks that do not need them.
- Motion: 150 to 250 ms, only to show state. No page entrance animation.
  Respect `prefers-reduced-motion`.
- Style what the browser draws too: text selection, text cursor (`caret-color`),
  focus rings, and tabular numbers in tables, all from the palette.
- Copy: controls name their action. Errors state the problem and how to recover.
  All text is English.
- Accessibility: semantic HTML, labeled form fields, logical tab order,
  `aria-live` for chat messages and errors.

## Icons

Single-stroke SVG components in `web/src/components/icons.jsx`. No icon library.
Do not add an `xmlns` attribute (it is an external URL string).

## Video rules

- Google Meet opens in a new tab: `target="_blank"` with
  `rel="noopener noreferrer"`. Never an `iframe`.
- Jitsi is embedded in an `iframe`.

## Data and network rules

- The client talks only to `/api` and `/ws`. No other host, CDN, remote image,
  or font. No keys in the code.
- The session is an `HttpOnly` cookie. Use `credentials: 'include'`. Requests that
  change state send `Content-Type: application/json`.
- Dates are shown in `America/Bogota`. The API sends UTC.
- Do not import `firebase` or `twilio`. Write all code from scratch.
