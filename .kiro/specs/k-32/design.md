# K-32 design

## Bottom bar label (R1)

The sidebar and the bottom bar are the same elements, and the stylesheet moves them.
The navigation entry for the new appointment gets a `shortLabel` of "New" in `web/src/lib/access.js`.
`Layout.jsx` passes it on as the `data-short` attribute of the link, and sets `aria-label` to the full
label, so the accessible name does not change. Other entries get no attribute and render as before.
Below 960 px, `app.css` hides the label text and draws `data-short` with `::after { content: attr(data-short) }`.
Using CSS for the short text keeps the link's text content equal to the full label.

## Appointment list (R2)

In `app.css`, the time cells (`.appt-time` and `.cell-end`) get `white-space: nowrap`.
The identifier in the Professional and Client columns gets `max-width: 8rem`, `overflow: hidden`,
`text-overflow: ellipsis`, and `white-space: nowrap`, scoped to `.appt-table`.
`Appointments.jsx` sets the `title` of the identifier to the full text shown.
Trade-off: on a 768 px screen with long identifiers, the table is wider than its wrapper and
scrolls inside the wrapper. The page itself does not overflow.

## Sign-in cards (R3)

The change is in the CSS of `tools/mock-idp/server.js` only:

- `.account` aligns its content to the start (`align-items: start`, `align-content: start`).
  Before, the rows of a card stretched with the tallest card of its row, and each name sat at a different height.
- `.account-meta` becomes a grid, so the role chip and the e-mail address each take a line.

The markup stays the same. A long name wraps inside its own card and moves that card's chip down.

## Own name (R4)

Each component gets the signed-in user from `useAuth()`. A value is shown as the `displayName`
when the identifier equals `user.id`, and as the identifier otherwise. The avatar initials come
from the text shown, so the avatar of the signed-in user reads "AR" for "Ana Rivera".

Places that show the other person only (the Home hero, Today, and Coming up) need no change,
because the signed-in person never appears there.
