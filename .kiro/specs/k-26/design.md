# K-26 design

## Approach

- `parseCookieValues` in `cookies.js` splits the header the same way as `parseCookies`
  and collects all values of one name.
- `api/src/auth/requestSession.js` exports `resolveSession(sessions, header, cookieName)`.
  It returns `{ auth, token, presented }`. Each attempt is a full
  `sessions.authenticate` call (hash, expiry, idle time, revocation).
- At most `MAX_CANDIDATES` (8) non-empty values are tried, so a forged header with many
  duplicates cannot cause many lookups. A browser sends one cookie per Path, so real
  requests carry two or three.
- Logout: with a live session it revokes the token that was used (or all sessions of the
  user). With none, it revokes every presented value, which equals the old behavior for a
  single cookie.
- Set-Cookie order on sign-in: the live `Path=/` cookie first, then the `Path=/api/`
  deletion. Existing tests read the first `d7_session=` line.
- `serializeCookie` and `clearCookie` already accept a `path`, so no change there.

## Test aid

The cookie jar of `auth.flow.test.js` keyed cookies by name only, so the `Path=/api/`
deletion removed the live cookie. The jar now remembers each path and applies a deletion
only to the cookie with the same path, like a browser.
