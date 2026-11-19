# K-26 tasks

- [x] 1. `cookies.js`: add `parseCookieValues`.
- [x] 2. `requestSession.js`: add `resolveSession`.
- [x] 3. `router.js`: use it in `/auth/me`, `/auth/logout`, and `requireSession`; delete the `Path=/api/` cookie on sign-in and logout.
- [x] 4. `chat/gateway.js`: use it in the handshake.
- [x] 5. Tests: `duplicateCookies.test.js`, sign-in deletion in `auth.flow.test.js`, handshake in `chat.ws.test.js`.
- [x] 6. `docs/SECURITY.md`: one sentence.
- [ ] 7. Run `node --test "api/**/*.test.js"`, then one commit without push.
