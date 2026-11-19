# K-08 Design

## Stack

React, React Router, Vite, Vitest with jsdom and Testing Library. Plain CSS with
variables. No UI or icon library.

## Layout of `web/`

```
index.html
vite.config.js            dev proxy: /api (prefix stripped) and /ws to 127.0.0.1:3000
test/hygiene.test.js      scans web/src for forbidden words and external URLs
src/
  main.jsx                fonts, styles, router mount
  App.jsx                 route table
  api/client.js           fetch wrapper, ApiError, endpoint functions
  auth/AuthContext.jsx    session state from GET /auth/me, logout
  lib/format.js           Bogota date formatting and Bogota-to-UTC conversion
  lib/access.js           role to screen map, nav items, route patterns
  components/
    icons.jsx             single-stroke SVG icons
    Layout.jsx            header, role-filtered navigation, main landmark
    Guard.jsx             RequireAuth and RequireRole
    States.jsx            Skeleton, EmptyState, ErrorState, NoPermission
    ChatPanel.jsx         WebSocket chat
    VideoPanel.jsx        Meet link or Jitsi iframe
  pages/                  Login, Home, Appointments, NewAppointment,
                          AppointmentPage, NewConsultation, Consultation, Audit
  styles/tokens.css       color, type, space, motion tokens
  styles/app.css          components and layout
  test/setup.js           jest-dom, cleanup
```

## Routing and access

`lib/access.js` is the single source for who may open what. `Guard` reads the
user from `AuthContext`:

- loading: page skeleton;
- no user: `<Navigate to="/login">`;
- role not allowed: `NoPermission` (inside the layout);
- else: the page.

`Layout` builds the navigation from the same map, so a role never sees links to
screens it cannot open.

## API client

`request(path, {method, body})` calls `/api` + path with `credentials: 'include'`.
With a body it sets `Content-Type: application/json`. A non-2xx answer throws
`ApiError {status, code, message}` from the API error shape. A network failure
throws `ApiError` with `status 0` and the message "Cannot reach the server."
A `401` from `/auth/me` means no session. Sign-in is a browser navigation to
`/api/auth/login`, not a fetch.

## Screen states

Each data page uses one `useLoad` pattern: `loading`, `error`, `data`. Rendering:
skeleton, `ErrorState` (message plus a "Try again" action), `EmptyState`
(instruction plus action), data. A `403` renders `NoPermission`.

## Video

`VideoPanel` calls the meeting endpoint on demand. Result `meet`: an `<a>` with
`target="_blank"` and `rel="noopener noreferrer"`. Result `jitsi`: an `<iframe>`
with `allow="camera; microphone; fullscreen; display-capture"`. Only `https:`
and loopback `http:` URLs are accepted; anything else shows an error.

## Chat

`ChatPanel` opens `ws(s)://<host>/ws?appointment=<id>`. It handles `history`,
`message`, and `error` frames, and close codes 4001, 4002, 4003. It sends
`{type:"message", body}`, blocks empty text, and limits input to 2000 bytes
before sending. The message list has `role="log"` and `aria-live="polite"`.
Errors use `role="alert"`. Own messages are matched by `senderId`.

## Dates

`formatDateTime(iso)` uses `Intl.DateTimeFormat('en-US', {timeZone: 'America/Bogota'})`.
`bogotaToUtcIso(date, time)` builds `${date}T${time}:00-05:00` (Bogota has no
daylight saving) and converts it with `toISOString()`.

## Visual system

Tokens from the steering file. Shell: a solid primary (`#7400b8`) top bar with
white text (8.6:1). Content is on near-white surfaces. Headings use `#5E60CE`.
Stat tiles use a neutral surface; the stat color pairs fill only the icon tile.
The main gradient fills a text-free brand band on the sign-in page. The button
gradient is used on the loading bar. Primary buttons are solid primary with
white text. Focus ring is a 3 px outline in the "now" color with offset.

Below 720 px, the navigation collapses into a `<details>` menu and tables stack
into labeled rows. All controls are at least 44 px high.

## Tests

- `test/hygiene.test.js`: forbidden words and external URLs in `web/src`; fonts
  imported from `@fontsource`; no `iframe` for Meet; no gradient text, no emoji.
- `src/lib/*.test.js`: date and access logic.
- `src/styles/design.test.js`: token contrast ratios and CSS rules.
- `src/pages/*.test.jsx`, `src/App.test.jsx`: states, roles, redirects, video,
  chat, English strings.
