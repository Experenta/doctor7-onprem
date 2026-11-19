# K-32 requirements: interface polish after the browser review

Source: the browser review of the v2 interface by the project manager.

## R1. Short label in the bottom bar

- At 375 px, the bottom bar shows "New" for the new-appointment destination, on one line.
- The sidebar and every other screen keep "New appointment".
- The accessible name of the link stays "New appointment" in both layouts.
- The icon of that destination lines up with the icons of the other destinations.

## R2. Appointment list at 768 px

- Each time (for example "10:00 AM") stays on one line.
- A long identifier ends with an ellipsis. Its full value is in the `title` attribute.
- The page has no horizontal overflow. The table may scroll inside its own wrapper.

## R3. Header of the sign-in cards on the mock identity provider

- Every account card has the same structure: avatar, name, the role chip on its own line,
  then the e-mail address, then the button.
- The headers of the cards in one row line up at the top.
- The markup that the tests and the smoke script read does not change.
- The page keeps its content security policy: no script and no external resource.

## R4. Own name instead of the own identifier

- Where the interface shows the identifier of the signed-in user, it shows that user's
  `displayName`. This applies to the appointment list and the appointment header.
- Other people keep their identifier.
- The API is not changed, and no name is invented.

## Out of scope

- Any change to `api/`, migrations, `packaging/`, `web/package.json`, network code, or other screens.
- Visual checks in a real browser are not part of this task.
