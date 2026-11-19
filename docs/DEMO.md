# Public demo: sign-in with the mock identity provider

> **Demo only. Do not install this on a production server.** The mock identity
> provider lets anyone pick a listed account, with no password. It signs tokens with
> a key that exists only in memory, and it is not a secure identity provider. A
> production server uses a real identity provider.

The public demo lets a visitor sign in without a real account. The demo host runs
the mock provider behind Apache, under the path `/idp/`. The API checks the
provider's tokens in the same way it does in production.

The demo data is synthetic. The accounts and records are invented, and they reset
on a schedule.

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

## Requirements

- A Debian host with Apache 2.4, with the modules `proxy`, `proxy_http`, and `ssl`.
- Node.js 22 or later, the same runtime as the API.
- A host name with a TLS certificate. `<host>` below stands for that host name. The
  session cookies are `Secure`, so the demo needs HTTPS.
- The synthetic seed loaded into an empty database (see `docs/MIGRATION.md`).

## Configuration

The deployment writes `/etc/doctor7/idp-demo.env`. The repository holds no host name.

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

## Install (manual steps)

The repository has no Debian package for the provider. These steps install it by hand.

1. Create a system user `doctor7-idp` with no login shell and no home directory.
2. Copy the provider to `/usr/lib/doctor7/mock-idp/`, the path the unit uses. The
   provider is `tools/mock-idp/server.js` with `rate-limit.js`, and it needs the
   `jose` package from the repository's `node_modules`.
3. Write `/etc/doctor7/idp-demo.env` as shown above. Give it mode 0640, owner
   `root`, group `doctor7-idp`.
4. Add the `/idp/` lines of `packaging/apache/idp-demo.conf.example` to the TLS
   virtual host of the demo host, the one that serves `/api`. Copy only the
   `ProxyPass`, the `ProxyPassReverse`, and the `/idp/` `Location` block. Do not
   copy the `/` block. Then run `apache2ctl configtest` and reload Apache.
5. Install the unit `packaging/systemd/doctor7-mock-idp.service` as
   `/etc/systemd/system/doctor7-mock-idp.service`, then run
   `systemctl daemon-reload`.
6. Start the provider with `systemctl start doctor7-mock-idp`. Enable it at boot
   only when the demo host needs that: `systemctl enable doctor7-mock-idp`. Nothing
   in this repository enables the unit.

Check the result: `https://<host>/idp/.well-known/openid-configuration` must report
`"issuer": "https://<host>/idp"`.

## Limits

- The login page (`/authorize`) and the token endpoint (`/token`) accept 120 and 60
  requests per minute from one client address. A client over the limit gets HTTP
  429 and a `Retry-After` header.
- The client address is the last `X-Forwarded-For` value. Apache adds that value.
  Keep `ProxyAddHeaders On`, which is the Apache default. Do not expose port 4010
  to the network. The provider listens on `127.0.0.1` only.

## Reset

The provider keeps no state. Its codes and signing key live in memory, so a restart
clears them. To reset the data, load a new seed into an empty database, as
`docs/MIGRATION.md` describes.

## Not covered by this demo

- A Debian package for the provider and its unit. Packaging is a separate task.
- A password or any other check of the account. Anyone can pick a listed account.
- Real identity, real email delivery, or real personal data. Do not use any of them
  on the demo.
