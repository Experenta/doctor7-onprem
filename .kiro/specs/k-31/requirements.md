# K-31 requirements: frontend v2, appointment screen, new appointment, consultation, audit log, and the demo sign-in page

K-30 built the design system, the shell, Home by role, and Appointments. The other screens
only got the new tokens. This task rebuilds them in the same visual world: the appointment
screen with the video and the chat, the new appointment form, the consultation sheet (to read
and to write), the audit log, and the sign-in page of the mock identity provider. The
behavior, the API calls, the routes, and the key English texts stay the same. The video logic
(stored meeting, the client's check every 15 seconds, provider failover) and the chat logic
(WebSocket, reconnect) are not touched. Only their presentation and structure change.

## Requirements

### Appointment screen

- R1. The head of the screen is compact. It shows the title "Appointment", the status as a
  chip, the start and end in Bogota time, and the professional and the client, each with
  initials. The buttons "Back to appointments" and, for the professional, "Write
  consultation" are in the head.
- R2. The video is the large element: a 16:9 stage on the left on wide screens (from 1100 px).
  A header above it shows the heading "Video consultation", a chip with the provider ("Jitsi"
  or "Google Meet") once the room is ready, and a chip with the state of the room.
- R3. The stage shows each state of the video panel: loading (skeleton), not started for the
  professional (the button "Start video meeting"), waiting for the client (soft pulse, the
  text "Your professional has not started the meeting yet", and the check every 15 seconds),
  starting (busy button), room ready (Jitsi in an `iframe`, Google Meet as a link that opens a
  new tab), closed appointment, no permission, and error with a retry.
- R4. The chat is a rail on the right on wide screens. On screens narrower than 1100 px the
  video comes first and the chat is below it. The chat shows messages as bubbles with initials,
  the messages of the user on one side, a connection indicator (connecting, connected, closed)
  with the existing status text, the button "Reconnect to chat" when a reconnect is allowed,
  and the composer. A closed appointment shows the existing "The chat is closed" notice in the
  same place.
- R5. Roles that have no video and no chat (administrator, auditor) see the head only, as
  today.
- R6. `VideoPanel`, `ChatPanel`, `lib/meeting.js`, and the appointment page keep their logic.
  Their tests stay and pass unchanged: the texts, roles, and labels they look up do not change.

### New appointment

- R7. One column, in two groups: people (Professional ID, Client ID) and date and time (Date,
  Start time, End time). The date and the times use the native pickers. The field names and
  labels do not change.
- R8. Duration chips (30, 45, 50, 60, and 90 minutes) set the end time from the start time. A
  chip is pressed when the chosen start and end have exactly that length. If the start changes
  while the length is one of the chips, the end follows the start.
- R9. A summary card updates while the user types: professional, client, date, time range,
  duration, and what is still missing. It does not repeat the field errors.
- R10. Errors are inline, next to the field, as today. A duration that would end after
  midnight is refused with an inline message on the end time. The request that creates the
  appointment does not change.

### Consultation sheet

- R11. The sheet to write has a header with a save indicator (not written yet, not saved yet,
  saving, not saved with the reason), a character count, and the same field, label, errors, and
  button names.
- R12. The sheet to read shows each note section under its own heading, the recorded date, and
  the hint about the audit log. A person who is not the professional sees a "Read only" chip.
  The professional sees a "Saved" chip.

### Audit log

- R13. The outcome filter is a group of chips: All outcomes, Success, Denied, Failure. A chip
  applies at once. The Action and Actor ID fields stay as a search with the button "Apply
  filters". The API request keeps the same parameters.
- R14. The table is dense, has a header that stays in view while the body scrolls, and shows
  the outcome as a chip with an icon (success, failure, denied), so color is not the only cue.
  The seven columns and their names do not change. Under 720 px the table stacks, as the other
  tables do.
- R15. Choosing a row opens its detail in a side panel with every field of the entry. The panel
  closes with a button and returns the focus to the row. The panel holds no clinical text,
  because the entries hold none.

### Sign-in page of the mock identity provider

- R16. The page has a left panel with the brand gradient, the logotype ("Doctor7", the 7 in
  turquoise, with an inline SVG glyph), and a short message. The account list is on the right.
  Each account is a card with initials, the name, a role chip, the e-mail address, and the
  button. On narrow screens the panel is on top.
- R17. The notice "Demonstration only." stays visible above the accounts.
- R18. The page requests nothing from outside: no font, no image, no script, no link. It uses
  the fonts of the system. The content security policy of the page does not change, and the
  page has no inline script.
- R19. The form, the hidden fields, the names of the controls, the account markup that the
  smoke script reads (`li.account`, `span.role`, the e-mail `span`, `button name="user"`), and
  the OIDC behavior do not change. The existing tests of `tools/mock-idp/` pass unchanged.

### Quality

- R20. The four data states (loading, empty, error, no permission) apply to the screens that
  load data. The appointment screen has a skeleton of its own shape.
- R21. Interactive parts have normal, hover, visible focus (3 px), active, disabled, and busy
  states. Targets are at least 44 px. Contrast follows the brief. Responsive from 360 to 1536
  px by structure.
- R22. The tests of the styles keep their coverage and add the new pairs and selectors:
  contrast of the new text pairs, 44 px targets of the new controls, turquoise on dark purple
  only, no side borders, no new animation, and the single use of the gradient.
- R23. The sign-in page has its own test: the contrast of its color pairs, no outside
  resource, no script, and the 44 px of its button.
- R24. No new dependency, no change in `web/package.json`, no request outside the origin, no
  emoji, no stock photo, no dark mode. No logo file.
- R25. The bundle budget test stays as it is. The measured sizes are in `docs/PERFORMANCE.md`.
- R26. All text is in English. All data is synthetic. The documents state the task count of 31
  and list the `k-31` folder.

## Out of scope

- `api/`, migrations, `packaging/`, `web/package.json`, and the OIDC protocol of the mock
  provider.
- The logic of the screens: the requests, the polling, the WebSocket, and the validation.
- New endpoints or API fields.
- The logo file and dark mode (open decisions).
