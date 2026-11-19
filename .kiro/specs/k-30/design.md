# K-30 design: frontend v2

## Tokens (`web/src/styles/tokens.css`)

- Palette tokens are named `--color-<hue>-<step>`: purple 950, 900, 700, 500, 100, 50;
  turquoise 500, 700, 100; magenta 600, 100; plus `--color-ink`, `--color-ink-muted`,
  `--color-line`, `--color-white`, and `--color-on-turquoise` (`#0B2A28`).
- Derived tokens, each with a contrast test:
  - `--color-turquoise-800` (`#07706B`): small text on light surfaces. Turquoise 700 is
    about 4:1 on white, so it only carries large text and graphics.
  - `--color-magenta-800` (`#9C0081`): small text on light surfaces (field errors, danger
    chips). Magenta 600 on white is about 4.6:1 but falls under 4.5:1 on the pale
    surfaces.
  - `--color-on-dark-muted` (`#CFC5EE`): secondary text on purple 950, tinted toward purple.
- Semantic aliases (`--color-bg`, `--color-surface`, `--color-primary`, `--color-heading`,
  `--color-focus`, and so on) point to palette tokens with `var()`. The test resolves them.
- `--gradient-brand` is `linear-gradient(135deg, var(--color-purple-700), var(--color-magenta-600))`.
  It is used by `.welcome-band` and `.login-band` only.
- Radii: `--radius-card` 16 px, `--radius-control` 12 px, `--radius-pill` 999 px.
  Shadows: `--shadow-soft` and `--shadow-raised`, both with offset and blur of 12 px or more.
- Type scale, ratio 1.2: `--text-sm` to `--text-3xl`. Motion: `--motion` is 180 ms.
- Fonts: Montserrat 700 and 800, Lato 400 and 700. The imports of weights 400, 500,
  and 600 of Montserrat leave `main.jsx`.

## Styles (`web/src/styles/app.css`)

One file, grouped by area: base, shell, surfaces, buttons, chips, forms, states, home,
appointments, and the screens that K-31 rebuilds (still styled with the tokens). Two
keyframes exist, `shimmer` and `pulse`. Both are switched off in the
`prefers-reduced-motion` block. No `border-left` or `border-right`, no `backdrop-filter`,
no text gradient. The timeline and the active indicator use pseudo-elements.

## Components

- `ui.jsx`: `Button` (variants primary, secondary, ghost, on-band; renders a button, a
  router link, or an anchor), `Chip`, `StatusChip`, `FilterChip` (`aria-pressed`), `Card`,
  `StatTile`, `Avatar`, `PageHeader`, `Segmented` (the List/Week switch), and `InlineAlert`
  (a problem inside a screen, with an optional retry).
- `States.jsx`: `Skeleton` (variants lines, home, list; one `role="status"` and one
  screen-reader label, the blocks are decorative), `EmptyState` (with `art`),
  `ErrorState`, `NoPermission`, `Loaded` (takes `skeleton`).
- `illustrations.jsx`: `CalendarArt` and `TrayArt`, own SVG, colored by classes.
- `brand.jsx`: `Glyph` and `Logotype`.
- `icons.jsx`: the existing icons keep their names (`access.js` reads them). New: list,
  week grid, arrow, check, pulse, ban, note.
- `Layout.jsx`: sidebar, user chip, outlet. One DOM serves both layouts. CSS moves the
  sidebar to the top and the navigation to the bottom below 960 px, so no control is
  rendered twice and the accessible names stay unique.

## Logic that is only presentation

`web/src/lib/schedule.js` (pure functions, unit tests): the Bogota day key of an instant
(Bogota has no daylight saving time, offset -05:00), day labels, week days from Monday,
grouping by day, the countdown text, and the long date. `web/src/lib/initials.js`:
initials of a name or an ID. `web/src/lib/useNow.js`: a clock that ticks every 30 s.

## Home by role (`web/src/pages/Home.jsx`)

- All roles: `WelcomeBand` outside the data block, so the heading and the band actions are
  there while data loads or fails.
- Professional: one `GET /appointments` (the call that exists). Figures: upcoming
  (`upcomingAppointments`), this week (appointments that are not cancelled and start in
  the current Monday to Sunday), past (not cancelled and already ended).
- "Start video meeting" calls the existing `createMeeting` and then opens the appointment
  page, where `VideoPanel` reads the stored meeting. A failure shows an error notice with
  the same messages as `VideoPanel`.
- Client: the same list call. For the next appointment it reads the stored meeting with
  the existing `getMeeting`. A 404 means "not started"; it asks again every 15 seconds
  (`MEETING_POLL_MS`) while the tab is visible and stops when the room appears or the page
  closes. Another failure shows a neutral line that sends the client to the appointment.
- Administrator: counts by status from the same list call.
- Auditor: one `GET /audit` (the call of the audit screen). Entries of today and denied
  entries of today come from the newest 100 entries. At 100 entries the figure reads
  "100+".

### Differences from the brief, each one for the PM to confirm

- "Pending notes" cannot be computed. The list has no field that says whether a
  consultation exists, and no endpoint lists consultations. The third figure is
  "Past appointments" instead.
- The client's consultation records are not listed on Home, for the same reason. The
  client Home shows the hero card and the next appointments.
- Rows show the professional ID and the client ID, because the API sends only IDs. Initials
  come from the ID (`u-luis` gives `LU`).

## Appointments (`web/src/pages/Appointments.jsx`)

- Filter and view are screen state in the component. No change to the request.
- Order: today and later, ascending by day; then earlier days, newest first, after an
  "Earlier" divider row.
- One `<table>`; each day is a `<tbody>` with a row header (`th scope="rowgroup"`).
  Columns: Starts, Ends, Status, Professional, Client, and an "Actions" column.
- The Starts link has a visible large time and a screen-reader span with the full
  date, so its accessible name stays "Dec 2, 2026, 5:00 AM GMT-5". The Ends cell has
  the same pattern.
- Quick action: an "Open" link in every row. No other action is offered, because the list
  does not say whether a consultation already exists.
- Week view: Monday to Sunday of the chosen week, with links per appointment.

## Tests

- `styles/design.test.js` is rewritten for the new tokens and keeps every check class:
  token values and uniqueness, no color outside tokens, text contrast pairs, graphic
  contrast, forbidden CSS, soft shadows, type scale, 44 px targets, motion, browser-drawn
  styles, control states, stacking tables, collapsing navigation, and fonts.
- New: `lib/schedule.test.js`, `lib/initials.test.js`, `components/ui.test.jsx`,
  `components/Layout.test.jsx`, `pages/Home.test.jsx`, and new cases in
  `pages/Appointments.test.jsx`.
- Changed existing assertions: the list test scopes the "Scheduled" lookup to the table,
  because the filter chip has the same word.

## Bundle

The initial JavaScript and CSS sizes are measured with `npm run build --workspace=web`
before and after and recorded in `docs/PERFORMANCE.md`. The budget of
`web/src/bundle-budget.test.js` changes only if the measured size needs it.

## Not verified here

Look in a real browser at 360, 768, and 1440 px, contrast by script on the built CSS,
real keyboard navigation, and a walk-through with a professional and a client. The PM
checks them.
