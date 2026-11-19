# Public demo: sign-in with the mock identity provider

> **Demo only. Do not install this on a production server.** The mock identity
> provider lets anyone pick a listed account, with no password. It signs tokens with
> a key that exists only in memory, and it is not a secure identity provider. A
> production server uses a real identity provider.

The public demo lets a visitor sign in without a real account. The demo host runs
the mock provider behind Apache, under the path `/idp/`. The API checks the
provider's tokens in the same way it does in production.

The demo data is synthetic. The accounts and records are invented. The data returns to
the seed by hand (the Reset section) or every night (the Nightly reset section).

## Accounts

Every account uses the reserved domain `example.test`.

| Email | Name | Role shown on the login page |
| --- | --- | --- |
| `ana.rivera@example.test` | Ana Rivera | Professional |
| `luis.mora@example.test` | Luis Mora | Client |
| `marta.solis@example.test` | Marta Solis | Administrator |
| `iris.vega@example.test` | Iris Vega | Auditor |
| `no.role@example.test` | No Role | No access |
| `pending@example.test` | Pending Verify | No access |

The last two accounts test a refused sign-in. The first is verified at the
provider but has no row in the database. The second has an unverified email at the
provider.

The provider serves its sign-in page itself, in the visual style of the web client. It has a
left panel with the brand gradient, one card per account with initials and a role chip, and the
notice "Demonstration only." The page loads no font, image, or script from any server, and it
uses the fonts of the system.

## Requirements

- A Debian host with Apache 2.4, with the modules `proxy`, `proxy_http`, and `ssl`.
- Node.js 22 or later, the same runtime as the API.
- A host name with a TLS certificate. `<host>` below stands for that host name. The
  session cookies are `Secure`, so the demo needs HTTPS.
- The synthetic seed loaded into an empty database (see `docs/MIGRATION.md`).

## Configuration

The package `doctor7-demo` creates `/etc/doctor7/idp-demo.env` from a template
that holds names only. The administrator fills in the values on the demo host. The
repository holds no host name.

```sh
MOCK_IDP_PUBLIC_URL=https://<host>/idp
MOCK_IDP_REDIRECT_URIS=https://<host>/api/auth/callback
MOCK_IDP_CLIENT_ID=<the client id of the API>
```

The API's own settings must match the provider:

- `OIDC_ISSUER` is exactly the value of `MOCK_IDP_PUBLIC_URL`. The API compares the
  two as strings, so a trailing slash makes them differ.
- `OIDC_CLIENT_ID` is the value of `MOCK_IDP_CLIENT_ID`.
- `OIDC_REDIRECT_URI` is the value of `MOCK_IDP_REDIRECT_URIS`.

Set `MOCK_IDP_PUBLIC_URL` only on the demo host. Setting it turns on the request
limits and the trust of the forwarded address described below.

The provider looks for Node.js in this order: `NODE_BIN` from
`/etc/doctor7/idp-demo.env`, then `/opt/node/current/bin/node`, then `node` in
`PATH`. It uses the first one that is version 22 or later. The unit stops with a
message when none qualifies.

## Install with the package

The package `doctor7-demo` holds the provider, its unit, and the settings template.
Install it on the demo host only. Never install it on a production server.

1. Install `doctor7-api` first. `doctor7-demo` depends on it, and the provider uses
   the Node.js lookup of that package.
2. Build the package on a machine with Node.js and `dpkg-deb`:
   `node packaging/build-deb.js demo --out /tmp/doctor7-debs`. The file is
   `doctor7-demo_<version>_all.deb`. Copy it to the demo host.
3. Install it: `sudo apt-get install ./doctor7-demo_<version>_all.deb`. The install
   creates the system user `doctor7-idp` and, when the file does not exist, the
   settings file `/etc/doctor7/idp-demo.env` with mode 0640. It never overwrites an
   existing settings file. It installs the unit `doctor7-mock-idp.service` but does
   not enable or start it. It also installs `/etc/doctor7/vhost-demo.conf`, the
   `/idp/` rules of the site.
4. Fill in `/etc/doctor7/idp-demo.env` as shown in the Configuration section. Set
   `NODE_BIN` in that file only when Node.js 22 is not at `/opt/node/current/bin/node`
   and not in `PATH`.
5. Reload Apache: `sudo apache2ctl configtest && sudo systemctl reload apache2`. The
   TLS host of `doctor7-web` includes `/etc/doctor7/vhost-demo.conf`, so no edit of
   the virtual host is needed. Do not copy the `/` block of the example into the host.
6. Enable and start the provider: `sudo systemctl enable --now doctor7-mock-idp.service`.
   Enable it at boot only when the demo host needs that. Nothing in the package
   enables the unit.

Check the result: `https://<host>/idp/.well-known/openid-configuration` must report
`"issuer": "https://<host>/idp"`.

### The /idp/ block

The package `doctor7-demo` installs the `/idp/` rules as `/etc/doctor7/vhost-demo.conf`.
The file is the only part of `packaging/apache/idp-demo.conf.example` that the site
uses. Its content is:

```apache
ProxyRequests Off

<Location "/idp/">
    Require all granted
</Location>

ProxyPass /idp/ http://127.0.0.1:4010/
ProxyPassReverse /idp/ http://127.0.0.1:4010/
```

The TLS host of `doctor7-web` ends with `IncludeOptional /etc/doctor7/vhost-demo.conf`.
When the file is missing, Apache ignores the include, so `doctor7-web` works without
the demo.

Without the package, copy the same lines into the TLS virtual host by hand. Do not copy
the `<Location "/">` block of the example. It denies every other path, and the site
needs those paths.

The web package's virtual host (`doctor7.conf`) excludes `/idp` from its client
routing rule, so a request to `/idp/` is not answered with `index.html`.

## Limits

- The login page (`/authorize`) and the token endpoint (`/token`) accept 120 and 60
  requests per minute from one client address. A client over the limit gets HTTP
  429 and a `Retry-After` header.
- The client address is the last `X-Forwarded-For` value. Apache adds that value.
  Keep `ProxyAddHeaders On`, which is the Apache default. Do not expose port 4010
  to the network. The provider listens on `127.0.0.1` only.

## Reset

The provider keeps no state. Its codes and signing key live in memory, so a restart
clears them. To reset the data by hand, load a new seed into an empty database, as
`docs/MIGRATION.md` describes. To reset it every night, use the next section.

## Nightly reset

**Demo only. This erases data. Never enable it on a production server.**

The package `doctor7-demo` holds a reset that returns the demo database to the synthetic seed. It is
off until an administrator turns it on. The command is `seed/reset-demo.js`, installed as
`/usr/lib/doctor7/seed/reset-demo.js`. The service `doctor7-demo-reset.service` (a oneshot) runs it
as the system user `doctor7-reset`. The timer `doctor7-demo-reset.timer` starts the service every day
at 04:00 America/Bogota. A run missed while the host was off is not made up.

### What is reset, and what is not

| Reset | Not reset |
|---|---|
| Appointments, video meetings, chat messages, and consultation records that visitors created. | The audit log (`audit_log`). It is append-only, so it is never deleted from, and it keeps growing. |
| Sessions and sign-in attempts. Every visitor is signed out. | The migration table (`schema_migrations`). |
| Users and centers, which the seed loads again with its fixed ids. | Any table whose name starts with `audit`. |
| Every table added to the schema later (clients, records, forms, revisions, and so on). | The schema itself. The reset never drops or truncates a table. |

The list of tables is read from the database (`information_schema`), not written in the script. A
table added by a later migration is emptied with no change to the script. The seed is the one of
`seed/generate.js`, built for the day of the run, so the appointments stay around the current date. The
seed audit entries are not loaded again, because the audit rows stay.

### Safeguards

The script stops with exit code 1 and changes nothing unless all of these hold:

1. `DEMO_MODE=1` is in its environment.
2. `DEMO_RESET_CONFIRM=erase-demo-data` is in its environment. This value is set only in
   `/etc/doctor7/demo-reset.env`, never by default.
3. `DEMO_RESET_DATABASE_URL` is set. It is the address of a database account that is not the API
   account. If it is missing, the script refuses. It never falls back to `DATABASE_URL`.
4. The name of the database ends in `_demo`.
5. The database has the table `schema_migrations`.

It never deletes from `audit_log` or `schema_migrations`. Foreign key checks are off only around the
delete transaction and are on again when it ends. It prints the name and the deleted row count of every
table, the loaded row counts of every collection, and the audit and migration row counts before and
after. It never prints the database address or a driver message. Exit code 2 means the reset finished
but some seed rows were rejected.

### Turn it on

1. Create a database account for the reset, apart from the API account. It needs `SELECT`, `INSERT`,
   and `DELETE` on the demo database, whose name ends in `_demo`. `information_schema` lists only the
   tables that the account can see, so the grant covers the whole database. The script itself never
   deletes from the audit log, but the account can, so give it to this script only.
2. Edit `/etc/doctor7/demo-reset.env` (mode 0640, group `doctor7-reset`, created by the package from a
   template with names only). Set `DEMO_MODE=1`, `DEMO_RESET_CONFIRM=erase-demo-data`, and
   `DEMO_RESET_DATABASE_URL` to the address of that account. The address uses the TCP form, with a host
   and the database name, such as `mysql://<user>:<password>@<db-host>/<name>_demo`.
3. Try it once: `sudo systemctl start doctor7-demo-reset.service`, then
   `journalctl -u doctor7-demo-reset.service`.
4. Turn on the timer: `sudo systemctl enable --now doctor7-demo-reset.timer`. Check it with
   `systemctl list-timers doctor7-demo-reset.timer`.

### Turn it off

`sudo systemctl disable --now doctor7-demo-reset.timer`. Remove `DEMO_RESET_CONFIRM` from
`/etc/doctor7/demo-reset.env` as well, so that nobody starts the service by hand by mistake.
`apt-get remove doctor7-demo` stops and disables the timer. `apt-get purge` also removes the settings
file.

Not verified in this repository: a run against a real MariaDB (the integration test needs
`DATABASE_URL` and is skipped without it), the behavior of the units under systemd, and the install on
the demo host.

## Demo-only Meet outage switch

The demo shows what the API does when Google Meet fails: it creates the meeting in Jitsi and says
so. Real Google is not used in the demo. A simulator stands in for it, and an administrator can make
the simulator fail with one switch.

**This switch does not exist in production.** The API mounts its routes, and adds their gate rules,
only when it starts with `DEMO_MODE=1`. A production server does not set `DEMO_MODE`. Then the path
`/demo/meet-outage` has no rule, so the gate answers it like every other unknown path (`403`, audited
as `no_rule`), the API holds no client for the simulator, and it never contacts it. Tests cover both
cases (`api/src/demo/meetOutage.http.test.js`).

### What it is

- The simulator is `tools/mock-google/server.js`. It answers the token endpoint and the Meet
  `spaces` endpoint of Google on `127.0.0.1:4020` only. It checks the signature of the assertion with
  a public key. Its `mode` is `ok` or, during the outage, `http_500`.
- `POST /demo/meet-outage` with `{"meetOutage": true}` or `{"meetOutage": false}` switches the mode.
  Only the role `admin` can call it. The change is written to the audit log as `demo.meet_outage_on` or
  `demo.meet_outage_off`, with the author and the result and without a body or a secret.
- The API talks to the simulator over loopback with a secret that both sides read from their settings
  files (`DEMO_MEET_CONTROL_SECRET` and `MOCK_GOOGLE_CONTROL_SECRET`). The simulator accepts control
  only from a loopback peer with that secret, and only the modes `ok` and `http_500`.
- A meeting that already exists is never moved. The outage changes the next meeting that a professional
  starts.

### How to turn it on

Do this on the demo host, after the install of `doctor7-demo` (see "Install with the package"). The
install already generated a synthetic key pair and the shared secret with `openssl`, in
`/etc/doctor7/mock-google.env`, `/etc/doctor7/meet-demo-public-key.pem`, and
`/etc/doctor7/meet-demo-credentials.env`. None of them is in the repository or in the package.

1. `JITSI_BASE_URL` stays in `/etc/doctor7/api.env`, because Jitsi is the failover target.
2. Install the drop-in that makes the API read the generated settings (they set `VIDEO_PROVIDER=meet`,
   `DEMO_MODE=1`, the simulator addresses, the secret, and the synthetic credential):

   ```sh
   sudo install -D -m 0644 /usr/share/doctor7/doctor7-api-demo-meet.conf.example /etc/systemd/system/doctor7-api.service.d/demo-meet.conf
   sudo systemctl daemon-reload
   ```

3. Start the simulator, then restart the API:

   ```sh
   sudo systemctl enable --now doctor7-mock-google.service
   sudo systemctl restart doctor7-api.service
   ```

The settings are these (names and the fixed demo values; the secret and the key are generated):

| Variable | Where | Value |
|---|---|---|
| `VIDEO_PROVIDER` | `meet-demo-credentials.env` | `meet` |
| `DEMO_MODE` | `meet-demo-credentials.env` | `1` |
| `GOOGLE_MEET_API_BASE_URL` | `meet-demo-credentials.env` | `http://127.0.0.1:4020` |
| `GOOGLE_MEET_DELEGATED_USER` | `meet-demo-credentials.env` | `clinic.organizer@example.test` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `meet-demo-credentials.env` | Synthetic service account, `token_uri` `http://127.0.0.1:4020/token` |
| `DEMO_MEET_CONTROL_URL` | `meet-demo-credentials.env` | `http://127.0.0.1:4020` |
| `DEMO_MEET_CONTROL_SECRET` | `meet-demo-credentials.env` | Generated on the host |
| `MOCK_GOOGLE_CONTROL_SECRET` | `mock-google.env` | The same generated value |
| `MOCK_GOOGLE_PUBLIC_KEY_FILE` | `mock-google.env` | `/etc/doctor7/meet-demo-public-key.pem` |

To turn it off for good, delete `/etc/systemd/system/doctor7-api.service.d/demo-meet.conf`, run
`systemctl daemon-reload`, restart `doctor7-api.service`, and disable `doctor7-mock-google.service`.

### How to use it in the demo

1. Sign in as the Administrator. The Home screen shows the card "Demo only: simulate a Google Meet
   outage". It appears only when the API answers `GET /demo/meet-outage`. On a server without
   `DEMO_MODE` the answer is an error, and the screen shows nothing.
2. Start a meeting as the Professional on any scheduled appointment, with the outage off. The
   appointment shows the chip "Google Meet (simulated)" and a link that opens in a new tab. The address
   is made up by the simulator, so the page that it opens on `meet.google.com` is not a real room.
3. As the Administrator, turn the switch on. The card says "Outage turned on". Then, as the Professional,
   open another scheduled appointment and start its meeting. Google Meet does not answer, so the API
   creates the meeting in Jitsi. The appointment shows the chip "Jitsi (fallback)", the notice "Google
   Meet was not available, so this meeting was created in Jitsi.", and the Jitsi room in the page. The
   audit log has `meeting.failover` and `meeting.create_jitsi`.
4. Turn the switch off to go back to Google Meet.

Not verified in this repository: the install on a Debian host (`openssl` key generation, file modes,
the drop-in), the behavior of the units under systemd, and the screens in a real browser.

## Not covered by this demo

- A password or any other check of the account. Anyone can pick a listed account.
- Real identity, real email delivery, or real personal data. Do not use any of them
  on the demo.



## Node 3: self-hosted Jitsi on Debian 13

Video consultations can use a Jitsi server that the clinic runs itself. The
`VIDEO_PROVIDER` setting of the API selects the provider (see `docs/VIDEO.md`).
This section records the install of the Jitsi node that was verified on a Debian 13
virtual machine. It follows the on-premise pattern of this project: the server runs
on the customer's machine, and no external video service is needed.

The text uses these markers. Replace them on the server only. Real addresses and
host names never go into the repository.

| Marker | Stands for |
| --- | --- |
| `<host>` | Host name of the site. |
| `<jitsi-host>` | Host name of the Jitsi server. In this demo it is `meet.<host>`. |
| `<local-ip>` | Private address of the instance. |
| `<public-ip>` | Public address of the instance. |

### Repository and package

The install uses the official Jitsi repository. Its entry is:

```text
deb [signed-by=/usr/share/keyrings/jitsi-keyring.gpg] https://download.jitsi.org stable/
```

The signing key is `https://download.jitsi.org/jitsi-key.gpg.key`. Convert it with
`gpg --dearmor` into the file named in `signed-by`. The conversion needs the
`gnupg` package.

Install the package `jitsi-meet`. It pulls in `jitsi-meet-web`,
`jitsi-meet-web-config`, `jitsi-meet-prosody`, `jicofo`, `jitsi-videobridge2`, and
`prosody` from the Debian 13 repository. The verified versions are `jitsi-meet`
2.0.11509-1 and `jitsi-videobridge2` 2.3-358.

The Jitsi installer found Apache and used it as the web server. It did not install
nginx.

### Installer answers

The install ran without prompts. These answers were set with
`debconf-set-selections` before the install:

```text
jitsi-videobridge2 jitsi-videobridge/jvb-hostname = <jitsi-host>
jitsi-meet-web-config jitsi-meet/cert-choice = I want to use my own certificate
jitsi-meet/cert-path-key = /etc/letsencrypt/live/<jitsi-host>/privkey.pem
jitsi-meet/cert-path-crt = /etc/letsencrypt/live/<jitsi-host>/fullchain.pem
jitsi-meet/jaas-choice = false
```

The lines above give the question and the answer. The verified install did not
record the debconf type of each question.

The certificate for `<jitsi-host>` was issued before the Jitsi install. It came from
`certbot` in webroot mode, through a minimal port 80 virtual host for that name. The
two certificate answers above point the installer at the files that `certbot` wrote.

### Cloud instance behind NAT (AWS)

On an instance behind NAT, the videobridge sees only its private address. Map that
address to the public one. Add this block at the end of
`/etc/jitsi/videobridge/jvb.conf`. The file is HOCON, so the block merges with the
rest of it. Then restart `jitsi-videobridge2`:

```text
ice4j.harvest.mapping.static-mappings = [
    { local-address = "<local-ip>", public-address = "<public-ip>", name = "demo-public-ip" }
]
```

The rest of the file already holds `ice4j.harvest.mapping.aws.enabled = false` and a
default STUN server. The block does not change them.

Do not use `sip-communicator.properties` with `NAT_HARVESTER_*` for this mapping. That
file does not exist in this layout.

### Site setting

On the site host, set `JITSI_ORIGIN` in `/etc/doctor7/web.vars.conf` to the origin of
the Jitsi server, `https://<jitsi-host>`. It is not the origin of the site. The
`frame-src` policy checks the Jitsi iframe against this value, so a wrong value
blocks the iframe.

### Ports

| Port | Protocol | Status | Purpose |
| --- | --- | --- | --- |
| 80 | TCP | Open to the Internet | Certificate challenge and redirect to HTTPS. |
| 443 | TCP | Open to the Internet | Site, demo provider, and Jitsi, selected by host name on the same Apache. |
| 10000 | UDP | Open to the Internet | Videobridge media. |
| 4443 | TCP | Not opened | Videobridge TCP fallback. |
| 5222, 5280 | TCP | Not opened | Prosody. Videobridge, prosody, and jicofo talk over localhost. |

A client on a network that blocks UDP 10000 cannot send media on this install,
because 4443/tcp is closed. This case was not tested.

Apache sets `Options -Indexes -Includes` for the whole server. The Jitsi file
`config.js` uses server-side includes, so Apache does not evaluate it. The file has
a default value, so the page still loads.

### Names

The site is `<host>` and Jitsi is `meet.<host>`. A different domain changes only the
names in this section and in `web.vars.conf`.

### Room names

Jitsi's Apache virtual host only accepts letters and digits in room names by default; keep room names alphanumeric or widen the RewriteRule.

The API makes room names of the form `doctor7` followed by 32 hexadecimal characters.
Meetings stored before K-29 hold names with a hyphen. The API returns those stored
addresses unchanged.

### Verification status

Verified on the Debian 13 virtual machine:

- The entry page of the meeting room, with its «Join meeting» button, was checked over HTTPS.
- Apache, prosody, jicofo, and jitsi-videobridge2 are active.
- The API creates the meeting (HTTP 201). The page places its address in an `iframe`,
  and the content of that iframe was not checked on the VM.

Not verified: a real audio and video call between two participants. The test browser
had no camera, so the call with real audio and video was not verified.
