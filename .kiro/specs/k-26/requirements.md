# K-26 requirements: duplicate session cookies

## Context

A browser that still stores an old `d7_session` cookie with `Path=/api/` (set before a
virtual host fix) sends it together with the current `Path=/` cookie. `parseCookies` keeps
the first value. When that one is expired, the new session is hidden and `/auth/me`
answers 401 after a correct sign-in.

## Requirements

1. `api/src/auth/cookies.js` has `parseCookieValues(header, name)`, which returns every
   value of that name in header order. `parseCookies` is unchanged and still keeps the
   first occurrence (the sign-in binding cookie relies on it).
2. One helper resolves the session from the header. It tries each value in order with
   `sessions.authenticate` and stops at the first live session. No check is relaxed, and
   no cookie value is logged. If no value is live, the result is the same 401 as today.
3. `/auth/me`, `/auth/logout`, `requireSession`, and the `/ws` handshake use the helper.
4. A successful sign-in and a logout also send a deletion of `d7_session` with
   `Path=/api/`, with the same HttpOnly, Secure, and SameSite attributes.
5. Logout revokes the session that was used (or every session of the user with
   `all=true`).
6. Tests cover: invalid then valid, expired then valid, valid then invalid, all invalid,
   revoked, logout with both deletions, the WebSocket handshake, and a property test.
7. `docs/SECURITY.md` states the behavior in one sentence.

## Out of scope

`web/`, `packaging/`, the virtual host, migrations, CSRF, rate limits, session lifetimes.
