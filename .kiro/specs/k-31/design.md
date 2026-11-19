# K-31 design: frontend v2, second part

K-31 reuses the system of K-30: the tokens, `ui.jsx`, `States.jsx`, `icons.jsx`, `brand.jsx`,
and the shell. It adds structure and styles for five screens and a restyle of one server page.

## Appointment screen (`pages/AppointmentPage.jsx`)

- A compact head card: row one has the `h1` "Appointment" and the buttons. Row two is a `dl`
  (Starts, Ends, Status, Professional, Client) that wraps by `auto-fit`. The participants have
  an `Avatar` with their initials, as in the Appointments list.
- `.appt-workspace` is a grid. One column below 1100 px (video first, chat second). From 1100 px,
  two columns: the video takes the free width and the chat rail is 23 rem.
- `VideoPanel` keeps its state machine. The render changes:
  - A card with a header (`h2` "Video consultation", a provider chip, a room state chip).
  - A 16:9 stage in purple 950 with white and tinted text. The `iframe` fills the stage. The
    other states are a centered block with an icon, a title, a text, and a button. The buttons on
    the stage use the `on-band` variant (white), the same one as on the welcome band.
  - The chip of the room state is derived from the existing state. It adds no state and no
    request. Its words avoid the sentences that the tests look up ("not scheduled", the waiting
    sentence).
  - Turquoise is used on the stage only as an icon or a dot on purple 950, as the steering file
    allows.
- `ChatPanel` keeps its logic. The render changes: a card with a header, a status line (a dot and
  the existing status text, the one `role="status"` of the screen), a log of bubbles with an
  `Avatar` (initials of the sender ID), and the composer. The bubbles of the user are purple 700
  with white text. The others are on the surface. Time stays in Bogota time.
- The skeleton has a new variant, `appointment` (a head block and a 16:9 block).

## New appointment (`pages/NewAppointment.jsx`, `lib/slots.js`)

- The form is a grid with three children: the card with the field groups, the summary card, and
  the actions. In one column they stack in that order. From 1100 px the fields and the summary
  sit side by side, and the summary is sticky. The summary is a sibling card, not a card inside
  a card.
- `lib/slots.js` holds pure helpers: `durationMinutes(start, end)`, `addMinutes(time, minutes)`
  (null past midnight), and `formatClock(time)`. They have unit tests.
- The duration chips are `FilterChip`s in a group named "Duration". The pressed state is derived
  from the start and the end, so there is no extra state. When the start changes and the current
  length is one of the chips, the end is recomputed.
- The summary is a plain section. It is not a live region, so a screen reader is not interrupted
  at each key press.

## Consultation (`pages/NewConsultation.jsx`, `pages/Consultation.jsx`)

- To write: header with `PageHeader`, a card with the label "Consultation note", the textarea, a
  character count, and a save indicator chip (`role="status"`). The indicator is derived: empty,
  draft, saving, or failed. There is no autosave, because the API has no endpoint for a draft.
- To read: `Consultation sheet` stays as the `h2`. Each key of the body is a section with an
  `h3` and a paragraph limited to 70 characters of width. A chip says "Saved" for the professional
  and "Read only" for every other role. Both read the role from `useAuth`.

## Audit log (`pages/Audit.jsx`)

- The outcome is state of its own and is applied when a chip is chosen. The Action and Actor ID
  fields keep a draft and are applied by the button "Apply filters", which keeps the current
  outcome. The request is built from the same three values as before. (This is the one change of
  interaction in the task. The select of the old screen needed the button too. The PM can ask for
  the old behavior.)
- The table gets `table-dense`. The wrapper scrolls from 720 px with a maximum height, and the
  header cells are sticky. The Action cell holds a button that opens the detail. The row also has
  a click handler, so the whole row is a target for the mouse, and the button is the one control
  for the keyboard and for assistive technology. (A pseudo-element that stretches the button over
  the row was not used, because `position: relative` on table rows is not reliable in every
  browser.)
- The detail is an `aside` after the table. From 1100 px it is the right column and is sticky.
  Below, it follows the table. When it opens, the focus moves to its heading, which scrolls it
  into view. Closing returns the focus to the button of the row.
- The outcome chip has an icon and the raw word (`success`, `denied`, `failure`).
- A "Clear filters" button shows beside the filters when a filter is active and the list is not
  empty. When the list is empty, the empty state has the button, as before, so a page never has
  two.

## Sign-in page of the mock identity provider (`tools/mock-idp/server.js`)

- Only `loginPage()` changes, and only its markup order and its `<style>` block. The content
  security policy stays `default-src 'none'; style-src 'unsafe-inline'; form-action 'self';
  frame-ancestors 'none'`. That policy allows the inline style block and no script, no font, no
  image, and no link, so the page has none of them. The glyph is inline SVG.
- Fonts are the system stack (`system-ui`, Segoe UI, Roboto, Helvetica Neue, Arial).
- The colors are CSS variables at the top of the style block. They repeat the palette of
  `tokens.css`, because the page cannot import it. The page test checks the values against
  `web/src/styles/tokens.css` so they cannot drift.
- Markup kept as it is, because other code reads it: the `form` and its action, the hidden
  inputs, `li.account`, `span.role` (with `role-none`), the e-mail `span` after the role, and
  `button type="submit" name="user"`.
- Initials come from the name and are escaped with the same function as every other value.
- The word that the old tests forbid in the whole HTML ("reset", in any case) is not used in the
  styles either.

## Tests

- `styles/design.test.js` adds the new text pairs, the 44 px selectors, the turquoise-on-dark
  list, and a check that the new CSS has no side border.
- `lib/slots.test.js`: the helpers.
- `pages/AppointmentPage.test.jsx`: new cases for the head, the provider and room chips, and the
  stacked structure. The existing cases are unchanged.
- `pages/NewAppointment` cases in `pages/Appointments.test.jsx`: the duration chips and the
  summary.
- `pages/Consultation.test.jsx`: the save indicator, the section headings, and the read-only chip.
- `pages/Audit.test.jsx`: the outcome chips (replaces the select), the detail panel, and the
  focus. The other cases stay.
- `tools/mock-idp/login-page.test.js`: contrast of the page colors, no outside resource, no
  script, the markup contract that the smoke script needs, and the notice.

## Bundle

Measured with `npm run build --workspace=web` before and after, in the same worktree. The
figures are in `docs/PERFORMANCE.md`. The budget stays unless the measure needs it.

## Not verified here

Look in a real browser at 360, 768, and 1440 px, contrast by script on the built CSS, a real
keyboard walk, the walk of the professional and the client, and the sign-in page in a browser
behind Apache. The PM checks them.
