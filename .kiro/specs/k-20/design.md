# K-20 Design

## Virtual host (`doctor7.conf`)

- Remove the line `ProxyPassReverseCookiePath / /api/`. Keep
  `ProxyPassReverseCookiePath /auth /api/auth`. The sign-in cookie reaches
  `/api/auth/callback`. The session cookie keeps `Path=/`, so `/ws` receives it.
- Change the client-routing condition to `!^/(api|ws|idp)(/|$)`.
- Add `Cross-Origin-Opener-Policy "same-origin"`, and add `includeSubDomains` to HSTS.
  Both match the API headers in `docs/SECURITY.md`.
- Rewrite the `JITSI_ORIGIN` comment: the Jitsi server origin, never the site origin.
  The `frame-src` and the camera and microphone permissions use it.

## Variables example (`web.vars.conf.example`)

- `SERVER_NAME demo.example.test`, `JITSI_ORIGIN https://meet.demo.example.test`.
  The two names differ, and both use the reserved `example.test` domain.

## Mock identity provider (`tools/mock-idp/server.js`)

- Remove the phrase "and resets regularly" from the notice of the sign-in page.
  The page keeps the rest of the notice. No timer is added.

## Demo guide (`docs/DEMO.md`)

- Remove "and they reset on a schedule" from the introduction. The "Reset" section
  already says that a reset means loading a new seed, which is manual.
- Document the `/idp/` block: the `ProxyPass` lines, the `/idp/` `Location` block,
  and the reason for the `idp` exclusion in the rewrite.
- Add "Node 3: self-hosted Jitsi on Debian 13". The section uses only placeholders.
  - Repository line and key: `deb [signed-by=/usr/share/keyrings/jitsi-keyring.gpg] https://download.jitsi.org stable/`.
    The key comes from `https://download.jitsi.org/jitsi-key.gpg.key` through
    `gpg --dearmor`. `gnupg` is required. The host `download.jitsi.org` is the vendor
    repository, not a deployment host, so the tests allow it.
  - Package `jitsi-meet` and the packages it pulls in. Versions seen: `jitsi-meet`
    2.0.11509-1, `jitsi-videobridge2` 2.3-358. Apache is the web server.
  - debconf answers, as the PM gave them. The debconf type of each question is not
    part of the verified install, so the section says to confirm it with the Jitsi
    handbook before use.
  - Certificate `meet.<host>` (`<jitsi-host>`), issued before with certbot in
    webroot mode from a minimal port 80 virtual host.
  - NAT mapping: the block from the PM, appended to the end of
    `/etc/jitsi/videobridge/jvb.conf`, then `jitsi-videobridge2` restarted. No
    `sip-communicator.properties`.
  - Ports: 80/tcp, 443/tcp, 10000/udp. Not opened: 4443/tcp, 5222, 5280. The
    section says that a client on a network that blocks UDP 10000 cannot send media
    without 4443, which the verified install does not open.
  - Verification status: verified (room page over HTTPS, four services active,
    API creates the meeting with 201 and embeds it in an iframe). Not verified: a
    real audio and video call between two participants.

## Operations guide (`docs/OPERATIONS.md`)

- Fix the `JITSI_ORIGIN` row and the cookie paragraph. Describe the `/idp` block.
- Add the sign-in and rate-limit variables, `ALLOWED_ORIGINS`, and `NODE_ENV`.
  Defaults come from `api/src/security/config.js` and `api/src/config.js`.

## Ports (`docs/PORTS.md`)

- Mark the Jitsi videobridge `4443/tcp` row as not opened on the verified install.
  Name `10000/udp` as the open media port.

## API (`api/src/server.js`)

- Pass `security: config.security` to `createApp`. `loadConfig` returns that key.
  The PM listed this single line. Its test would live in `api/src/server.test.js`,
  which is not in the scope of this task, so the test is not added here (see tasks).

## Tests

- `packaging/build-deb.test.js` reads the vhost and the variables example. The old
  test that required both cookie rules is replaced by one that forbids the root rule.
- `tools/mock-idp/demo.test.js` requires the removed phrase. It now forbids it.
- `tools/mock-idp/demo-docs.test.js` checks the host list of DEMO.md. It accepts
  placeholders, `example.test` names, loopback, and the vendor repository host. It
  also checks that no IPv4 address appears, and that no sentence says that a reset
  is scheduled.

## Decisions taken

- The `/idp` exclusion is added although the virtual host does not proxy `/idp`
  itself. The demo adds that block to this host (see DEMO.md), and the rewrite must
  not catch it.
- `VideoPanel.jsx` is unchanged. The existing tests in `AppointmentPage.test.jsx`
  cover R6.
