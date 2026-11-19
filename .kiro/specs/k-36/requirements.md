# K-36 requirements

Goal: make the Meet to Jitsi failover visible in the public demo, with a switch that exists
only when the API starts with `DEMO_MODE=1`.

1. The `doctor7-demo` package installs the Google simulator (`tools/mock-google/server.js`) as
   the unit `doctor7-mock-google.service`. The unit is disabled and stopped after the install.
   It runs as the unprivileged user `doctor7-meet`, listens on `127.0.0.1` only, and has the
   same hardening as `doctor7-mock-idp.service`.
2. The `postinst` of `doctor7-demo` generates a synthetic RSA key pair and a shared control
   secret with `openssl`, on the demo host, only when the files do not exist yet. No key,
   secret, or token is stored in the repository. The files are 0640, owned by root and the
   group of the service that needs them.
3. The demo API runs with `VIDEO_PROVIDER=meet` pointed at the simulator
   (`GOOGLE_MEET_API_BASE_URL`, `token_uri` inside `GOOGLE_SERVICE_ACCOUNT_JSON`,
   `GOOGLE_MEET_DELEGATED_USER`). The values are documented, and the package ships them as
   generated files plus a systemd drop-in that an administrator copies on purpose.
4. Demo switch. `GET` and `POST /demo/meet-outage` exist only when `DEMO_MODE=1`.
   - Without `DEMO_MODE`, no rule and no router exist. The request is answered like any other
     path without a rule, and the API never contacts the simulator (test).
   - `POST` takes `{"meetOutage": true|false}`, JSON only, checked by a schema. The `Origin`
     check and the write rate limit of the other state-changing routes apply.
   - Only the role `admin` can `POST`. The other roles get `403` from the gate. `GET` is open to
     every role at the gate, and the handler answers `404` to a caller who cannot read.
   - Each change writes the audit entry `demo.meet_outage_on` or `demo.meet_outage_off`, with the
     actor and the outcome. The entry holds no body and no secret.
   - The API talks to the simulator over loopback with a shared secret read from the
     environment. The simulator accepts control only from loopback, with that secret, and only
     the modes `ok` and `http_500`.
5. Web (English). The administrator Home screen shows the switch "Demo only: simulate a Google
   Meet outage", with state, help text, and a visible confirmation. It asks `GET /demo/meet-outage`
   first and shows nothing when the answer is an error. The appointment screen shows the provider
   chip "Google Meet (simulated)" or "Jitsi (fallback)" and, after a failover, the notice "Google
   Meet was not available, so this meeting was created in Jitsi."
6. `GET` and `POST /appointments/:id/meeting` add the boolean `fallback`, derived from the
   configuration: `selected === 'meet' && provider === 'jitsi'`. The database schema does not change.
7. Tests cover the API, the simulator, the web client, and the packaging. Documents are updated
   (`DEMO`, `VIDEO`, `AUDIT`, `AUTHORIZATION`, `SECURITY`, `OPERATIONS`, `API`), and the count
   documents say 36 tasks and list the folder `k-36`.
8. Out of scope: migrations, `web/package.json`, the Apache virtual host, and any change of the
   authorization policy beyond the one `demo` resource.
