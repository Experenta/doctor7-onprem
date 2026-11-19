# K-30 requirements: frontend v2, design system, shell, role Home, and Appointments

The web client looks too simple. This task rebuilds its look with the Doctor7 palette
(purple, turquoise, magenta) and a shell that people recognize from clinical tools. The
behavior, the API calls, the routes, and the key English texts stay the same. The screen
of one appointment, the new appointment form, the consultation sheet, the audit log, and
the mock identity provider sign-in page are rebuilt in K-31. Here they only get the new
tokens, so they are not visually broken.

## Requirements

### Design system

- R1. `web/src/styles/tokens.css` holds every color once, as CSS variables: the purple,
  turquoise, magenta, and neutral tokens of `.kiro/steering/frontend-design.md`, the
  brand gradient (purple 700 to magenta 600, 135 degrees), type sizes (ratio 1.2),
  radii (16 px cards, 12 px controls, 999 px chips), two shadow levels, spacing,
  and motion (180 ms). No other file holds a hex, `rgb()`, or `hsl()` value.
- R2. Three derived tokens exist: a turquoise for small text on light surfaces, a
  magenta for small text on light surfaces, and a tinted text color on purple 950. A
  test computes the contrast of every text and graphic pair that the styles use.
- R3. Turquoise `#18E4DC` is never a text color on a light surface. The test checks
  that it is text only on purple 700, 900 or 950, and that its contrast on a light
  surface is too low for text.
- R4. Base components are reusable and live in `web/src/components/`: button, chip
  (static and filter), card, figure tile, avatar with initials, loading skeleton with
  shimmer, empty state with an own SVG illustration in brand colors, error notice with
  retry, and no-permission notice.
- R5. Icons are own single-stroke inline SVG components. The brand has a typographic
  logotype ("Doctor7", the 7 in turquoise on purple) and a simple own glyph. The logo
  file is not in the repository.
- R6. Fonts are Montserrat 700 and 800 and Lato 400 and 700, from `@fontsource`. No
  request leaves the origin. No dependency is added.
- R7. Motion lasts 150 to 200 ms. The only animations are the loading shimmer and the
  "waiting" pulse. Every animation stops under `prefers-reduced-motion`.

### Shell

- R8. A fixed left sidebar in purple 950 holds the logotype, the navigation, and the user
  chip (initials, name, role, and the "Sign out" button). The active item has a
  turquoise indicator. Below 960 px the sidebar becomes a top bar with the logotype and
  the user chip, and the navigation becomes a bottom bar. The navigation keeps its
  accessible name "Main", lists links only, and shows each role only its own links
  (`web/src/lib/access.js` is unchanged).
- R9. The page header is light: title, today's date in Bogota time, and actions.
- R10. `Layout.jsx` is replaced. Targets are at least 44 px. Focus rings are 3 px.

### Home by role

- R11. Every role sees a welcome band with the brand gradient, the heading
  "Welcome, <name>", the date, and the role. The band is the only place for the gradient
  on these screens.
- R12. Professional: the next appointment as a hero card (large time, the full date and
  time in Bogota time, the client, a countdown or "Happening now", the button "Start
  video meeting", and the link "Open next appointment"); three figure tiles (upcoming
  appointments, appointments this week, past appointments); a week strip of seven days
  with one dot per appointment; a short "Today" list. The link "Schedule an appointment"
  is in the band.
- R13. Client: the hero card of the next appointment with the room state: "Your
  professional has not started yet" with a soft pulse, or "Room ready" with a button.
  A short list of the next appointments.
- R14. Administrator: a summary of the center with the appointments by status, a short
  list of the next appointments, and the link "New appointment".
- R15. Auditor: figure tiles for the audit entries of today and the denied entries of
  today, and the link "Open audit log". No appointment data is requested.
- R16. Each Home block has four data states: loading (skeleton), empty (illustration
  and a next step), error (message and "Try again"), and no permission (when the API
  answers 403).

### Appointments

- R17. A switch between List and Week, filter chips All, Scheduled, and Closed (with
  counts), and rows grouped by day with a timeline. A row shows initials, the time, the
  status, and a quick action.
- R18. The list stays one table with `data-label` cells that stack under 720 px. The link
  of a row has the full Bogota date and time as its accessible name.
- R19. The Week view shows seven day columns with previous, next, and current week
  buttons. Under 720 px the days stack.
- R20. The states of R16 apply. A filter with no result shows its own empty state with a
  button that shows all appointments.

### Quality

- R21. Same behavior, API, routes, and key English texts. Existing tests stay. A test
  that checked the old look is updated to the new system and keeps its coverage:
  contrast, unique tokens, no external requests, touch targets, motion, and no
  forbidden styles.
- R22. No new dependency and no change to `web/package.json`. No request leaves the
  origin. No emoji and no stock photos. No dark mode.
- R23. The bundle budget test stays. The measured sizes are in `docs/PERFORMANCE.md`.
- R24. Responsive from 360 to 1536 px by structure.
- R25. All text is in English. All data is synthetic. The documents state the task count
  of 30 and list the `k-30` folder.

## Out of scope

- `api/`, migrations, `packaging/`, `tools/` (the mock identity provider sign-in page is
  K-31), and `web/package.json`.
- The rebuild of the appointment screen, the new appointment form, the consultation
  sheet, and the audit log (K-31).
- New API fields or endpoints.
- The logo file and dark mode (open decisions).
