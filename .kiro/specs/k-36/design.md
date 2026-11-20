# K-36 design

## Files touched (28 in the end, without the specification, tests, and count documents)

Two files are not in the first list below: `api/src/video/index.js` (the `demoMode` flag) and
`packaging/demo/usr/share/doctor7/idp-demo.env.example` (comments that point to `docs/DEMO.md`).

API (6): `api/src/authz/policy.js` (resource `demo`, admin `read` and `update`), `api/src/app.js`
(mount), `api/src/video/router.js` (`fallback`), `api/src/demo/config.js`, `api/src/demo/control.js`,
`api/src/demo/router.js` (new).
Simulator (1): `tools/mock-google/server.js` (control endpoint).
Web (4): `web/src/api/client.js`, `web/src/components/DemoOutageSwitch.jsx` (new),
`web/src/pages/Home.jsx`, `web/src/components/VideoPanel.jsx`. No CSS change: the switch uses
existing classes.
Packaging (8): `packaging/build-deb.js`, `packaging/demo/DEBIAN/{control,postinst,prerm,postrm}`,
`packaging/demo/usr/lib/systemd/system/doctor7-mock-google.service` (new),
`packaging/demo/usr/lib/doctor7/start-google.sh` (new),
`packaging/demo/usr/share/doctor7/doctor7-api-demo-meet.conf.example` (new).
Documents (7): `docs/DEMO.md`, `VIDEO.md`, `AUDIT.md`, `AUTHORIZATION.md`, `SECURITY.md`,
`OPERATIONS.md`, `API.md`.

The count is close to the limit of about 25. The authorization policy gets one resource, not a
broad change, so the stop rule does not apply.

## API

- `loadDemoConfig(env)` returns `null` unless `DEMO_MODE=1`. `0`, empty, and unset mean off. Any
  other value stops startup. With `1` it requires `DEMO_MEET_CONTROL_URL` (http, loopback host,
  no path) and `DEMO_MEET_CONTROL_SECRET` (at least 32 characters). Errors name the variable only.
  `createApp` calls it only when sign-in is on, and `options.demo.config` replaces it in tests.
- `createMeetControl({config, fetchImpl})` calls the simulator: `GET` and `POST /control/mode` with
  the header `x-demo-control-secret`. Time limit, no redirects, fixed error text.
- The gate gets the demo rules only when the config is not null (`rules` parameter of
  `createAuthzGate`). The router is mounted under the same condition. Without `DEMO_MODE` there is
  no rule, so the gate answers `403 no_rule`, as for every unknown path. The task text said 404.
  The gate runs before the router, so a missing route cannot be a 404 in this API. See the report.
- Routes: `GET /demo/meet-outage` (`anyRole` at the gate, like the meeting read, then `can(read)`
  or `404`) and `POST /demo/meet-outage` (gate: roles with the `demo update` cell, which is `admin`).
- Audit: `demo.meet_outage_on` and `demo.meet_outage_off`, target type `demo`, no target id,
  `success`, or `failure` with reason `simulator_unreachable`. A refused `GET` writes `demo.read`
  with `denied`.
- `fallback` is computed in the video router from `service.selected` and the stored provider.
  `simulated` (added while implementing) is true only with `DEMO_MODE=1` and a stored `meet` provider.
  Without it the web client could not tell a real Meet meeting from a simulated one, and production would
  label real Google Meet as "(simulated)". `createVideo` gets a `demoMode` flag from `app.js` (one more file:
  `api/src/video/index.js`).

## Simulator

`createMockGoogle({controlSecret})`. Without a secret the control paths answer 404. With it:
loopback peer only, no `X-Forwarded-For`, constant-time secret check, body limited, modes `ok` and
`http_500` only. The CLI reads `MOCK_GOOGLE_CONTROL_SECRET`.

## Packaging

- User and group `doctor7-meet`. Unit `doctor7-mock-google.service`, port 4020, `start-google.sh`
  (same Node lookup as `start-idp.sh`), plus `IPAddressDeny=any` and `IPAddressAllow=localhost`.
- `postinst` creates, only when missing: `/etc/doctor7/mock-google.env` (0640 root:doctor7-meet:
  secret, public key path, port), `/etc/doctor7/meet-demo-service-account.pub.pem` (same mode),
  and `/etc/doctor7/meet-demo-api.env` (0640 root:doctor7: the API variables, with the credential as
  one single-quoted JSON line). The private key exists only in a 0700 temporary folder and in that
  file. `openssl` is a dependency of the package.
- The API reads the file only after an administrator installs the drop-in
  `doctor7-api-demo-meet.conf.example`. Nothing is wired by default.
- `purge` removes only these generated files. `prerm` stops and disables the new unit.

## Web

`DemoOutageSwitch` loads the state, renders nothing on any error, and otherwise renders a card with
a `role="switch"` button and an `aria-live` status line. The chip label comes from
`meeting.provider` and `meeting.fallback`.

## Not verified here

Real browser behavior, systemd, `openssl`, and `sh` execution of `postinst` on the VM.
