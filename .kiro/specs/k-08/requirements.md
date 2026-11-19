# K-08 Requirements: thin English frontend

Contract: `docs/API.md`. Design rules: `.kiro/steering/frontend-design.md`.

## Global

- R1. The client calls only `/api/*` and `/ws`. No external URL appears in `web/src`.
- R2. Every request uses `credentials: 'include'`. Requests with a body send
  `Content-Type: application/json`.
- R3. All visible text is English. Dates use `America/Bogota`.
- R4. A visitor without a session is redirected to `/login`.
- R5. A signed-in user sees only the links of screens their role may use. A direct
  visit to a screen of another role shows the no-permission state.
- R6. Every screen has loading (skeleton), empty, error, and no-permission states.
- R7. Fonts come from `@fontsource` and are part of the build output.

## Role access

| Screen | professional | client | admin | auditor |
| --- | --- | --- | --- | --- |
| Home | yes | yes | yes | yes |
| Appointments list | yes | yes | yes | no |
| New appointment | yes | no | yes | no |
| Appointment page | yes | yes | yes | no |
| New consultation | yes | no | no | no |
| Consultation sheet | yes | yes | yes | no |
| Audit | no | no | no | yes |

## Screens

### Sign in (`/login`)
- R8. Shows one "Sign in" action that navigates the browser to `/api/auth/login`.
- R9. A signed-in user who opens it goes to Home.

### Home (`/`)
- R10. Shows the user's name and role, and a role-specific set of actions.
- R11. For professional, client, and admin it shows the count of upcoming
  appointments and the next one, loaded from `GET /appointments`.
- R12. The auditor sees a link to Audit and no appointment data.

### Appointments (`/appointments`, `/appointments/new`)
- R13. The list shows start, end, status, professional ID, and client ID, ordered
  as the API returns them. On narrow screens rows stack.
- R14. Empty list: explains how to create one (professional, admin) or that the
  professional schedules it (client).
- R15. The form takes professional ID, client ID, date, start time, and end time,
  entered in Bogota time, and sends UTC to `POST /appointments`. A professional's
  own ID is fixed. Field errors show next to the form with a way to recover.
- R16. After creation the user goes to the appointment page.

### Appointment page (`/appointments/:id`)
- R17. Shows the appointment details and status.
- R18. The professional can start a video meeting (`POST /appointments/:id/meeting`).
  For `meet` the result is a link that opens a new tab with
  `rel="noopener noreferrer"`. For `jitsi` the meeting is embedded in an `iframe`.
  Never an `iframe` for Meet.
- R19. Client and admin see a short note that the professional starts video.
- R20. Professional and client see the chat over `/ws?appointment=<id>` when the
  status is `scheduled`. Admin sees no chat. Messages are announced through
  `aria-live`. The panel shows connecting, connected, closed, and error states.
- R21. A 404 from the API shows the error state "Appointment not found".
- R22. The professional sees an action to write the consultation.

### Consultation (`/appointments/:id/consultation`, `/consultations/:id`)
- R23. The professional writes a note and saves it with `POST /consultations`;
  then the sheet opens.
- R24. The sheet shows the consultation body as labeled fields, the creation time,
  and a link to the appointment.

### Audit (`/audit`)
- R25. A table of entries with time, actor, action, target, outcome, reason, and IP.
- R26. Filters: outcome, action, actor ID. Applying filters reloads the list.
- R27. Empty result: says that no entries match and how to widen the filters.

## Known API gaps (reported, not worked around)

- The appointment object has no meeting URL. Only the professional can create
  one, so the client cannot get the link from the API.
- There is no endpoint that lists consultations or finds one by appointment, so
  the sheet is reached after creation or by its URL.
- There is no endpoint that lists users, so the form takes user IDs.
- Appointments carry user IDs, not names.
