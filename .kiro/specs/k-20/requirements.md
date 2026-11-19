# K-20 Requirements: live demo fixes (cookie path, /idp, Jitsi origin, video node guide)

Status: the project manager ran the demo on a Debian 13 virtual machine and tested
it in a real browser: sign-in, appointments, chat, and a meeting on a self-hosted
Jitsi. Three repository defects needed manual fixes on that machine. This task
commits those fixes, adds tests, and fixes two more problems found in the demo.

## Background

- The API sets the sign-in cookie with `Path=/auth` and the session cookie with
  `Path=/`. Apache rewrites cookie paths with `ProxyPassReverseCookiePath`.
- The chat runs on `/ws`, which has no `/api` prefix. A session cookie scoped to
  `/api/` is not sent to `/ws`.
- The demo host serves the mock identity provider under `/idp/` on the same TLS
  host. The client routing rule must not catch those requests.
- Jitsi runs in an `iframe`, and the `frame-src` policy checks the origin of the
  Jitsi server, not the origin of the site.

## Requirements

- R1. The virtual host `packaging/web/etc/apache2/sites-available/doctor7.conf`
  contains `ProxyPassReverseCookiePath /auth /api/auth` and no
  `ProxyPassReverseCookiePath / /api/` line. A comment next to the rule explains
  that the session cookie keeps `Path=/`, so `/ws` receives it.
- R2. The client-routing `RewriteCond` in the virtual host excludes `api`, `ws`,
  and `idp`: `!^/(api|ws|idp)(/|$)`.
- R3. `JITSI_ORIGIN` is the origin of the Jitsi server, not of the site. The example
  in `packaging/web/usr/share/doctor7/web.vars.conf.example` uses a host that differs
  from `SERVER_NAME`. The `frame-src` policy uses `${JITSI_ORIGIN}`. The comments of
  the virtual host and `docs/OPERATIONS.md` say the same.
- R4. The sign-in page of the mock identity provider and `docs/DEMO.md` do not
  claim a scheduled reset of the data. No timer is added.
- R5. `docs/DEMO.md` has the section "Node 3: self-hosted Jitsi on Debian 13". It
  describes the install from the PM's verified steps, uses only placeholders
  (`<host>`, `<jitsi-host>`, `<local-ip>`, `<public-ip>`), gives the port list,
  gives the NAT mapping for `ice4j.harvest.mapping.static-mappings` in
  `/etc/jitsi/videobridge/jvb.conf`, and states what was verified and what was not.
- R6. The Meet button opens a new tab with `target="_blank"` and
  `rel="noopener noreferrer"`, and Meet is never an `iframe`. Only Jitsi is embedded.
  The existing tests of `web/src/pages/AppointmentPage.test.jsx` cover this.
- R7. Corrections inherited from K-12, limited to the lines named by the PM:
  - R7.1 `api/src/server.js` passes `config.security` to `createApp`. The key exists
    in `loadConfig`.
  - R7.2 `docs/OPERATIONS.md` lists `ALLOWED_ORIGINS`, `RATE_LIMIT_LOGIN_WINDOW_MS`,
    `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_WRITE_WINDOW_MS`, `RATE_LIMIT_WRITE_MAX`, and
    the rule that `NODE_ENV=production` requires sign-in.
  - R7.3 The virtual host sets `Cross-Origin-Opener-Policy "same-origin"` and adds
    `includeSubDomains` to HSTS, as `docs/SECURITY.md` states.
- R8. `docs/DEMO.md` and `docs/OPERATIONS.md` document the `/idp/` block of
  `packaging/apache/idp-demo.conf.example`.
- R9. Tests check R1 to R5 and R7.3 by reading the files. No test reads a `.env`
  file or any cloud configuration.
- R10. `docs/DEMO.md` contains no public IP address and no real host name. It uses
  only placeholders, `example.test` names, and the Jitsi vendor repository host
  `download.jitsi.org` that the install command needs. A test checks this.
- R11. `docs/DEMO.md` states that a real audio and video call between two
  participants was not verified.

## Out of scope

- Installing software, changing the branch, pushing, or running cloud commands.
- Any change to `api/` other than the one line of R7.1.
- Client names, account names, real host names, and IP addresses.
- Bugs found outside this task are reported, not fixed.
