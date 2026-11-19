# K-18 Requirements: public demo behind Apache

Status: the demo instance runs the mock identity provider on a public path. The
mock provider is for the demo only. It never runs in production.

## Background

The mock identity provider (`tools/mock-idp/server.js`) sets its issuer to
`http://127.0.0.1:<port>` and listens on loopback. A browser outside the host
cannot finish a sign-in. The demo needs the provider behind Apache on an HTTPS
path, with the issuer that the API checks.

## Provider

- R1. When `MOCK_IDP_PUBLIC_URL` is set, the issuer is that value. The discovery
  document, the `iss` claim of every ID token, and the `authorization_endpoint`,
  `token_endpoint`, and `jwks_uri` values all use it as the prefix.
- R2. When `MOCK_IDP_PUBLIC_URL` is set, the provider also answers the paths
  without the prefix, because Apache removes the prefix before it forwards.
- R3. When `MOCK_IDP_PUBLIC_URL` is not set, the provider behaves as before:
  the issuer is `http://127.0.0.1:<port>` and no path has a prefix.
- R4. The provider listens only on `127.0.0.1`, in both modes.
- R5. `MOCK_IDP_PUBLIC_URL` must be an absolute `https` URL. Plain `http` is
  allowed only for a loopback host. It must not have a query, a fragment,
  credentials, or a trailing slash. The value is used exactly as given, because
  the API compares `OIDC_ISSUER` with the issuer as a string.
- R6. `MOCK_IDP_REDIRECT_URIS` accepts the callback URL of the demo,
  `https://<host>/api/auth/callback`, as an exact registered value.
- R7. The provider adds the user `iris.vega@example.test` (auditor, email
  verified). The other seed accounts, `ana.rivera`, `luis.mora`, and
  `marta.solis`, are already in its list.

## Login page

- R8. The login page lists the four demo accounts with their roles, in English:
  Professional, Client, Administrator, Auditor. Each role comes from a fixed
  table in the provider.
- R9. `no.role@example.test` and `pending@example.test` stay in the provider.
  The page shows them with the role "No access". Seed participants who have no
  sign-in in the demo do not appear.
- R10. The page says in English that the accounts are synthetic demonstration
  accounts, and that the data resets regularly.
- R11. The page escapes every value it prints, and it uses the sober design of
  `.kiro/steering/frontend-design.md` as far as a single HTML file allows.
- R12. The form posts to the provider's own `/authorize` endpoint, using the
  public URL when one is set.

## Limits

- R13. The login page (`/authorize`) and the token endpoint (`/token`) have a
  request limit per client IP, active in demo mode. A client over the limit gets
  HTTP 429 and a `Retry-After` header.
- R14. In demo mode, the client IP is the last value of `X-Forwarded-For`, which
  Apache adds. Without a proxy, the socket address is used.

## Deployment (demo only)

- R15. `packaging/systemd/doctor7-mock-idp.service` runs the provider as the
  unprivileged user `doctor7-idp`, with `NoNewPrivileges=true` and
  `ProtectSystem=strict`. The unit is not enabled by default. The host name is
  not in the unit. It comes from an environment file that the deployment writes.
- R16. `packaging/apache/idp-demo.conf.example` forwards only `/idp/` to
  `127.0.0.1:4010`. Every other path is denied.
- R17. `docs/DEMO.md` says that the demo must not be installed in production.
  A test checks that statement.
- R18. Examples and tests use `demo.example.test` as the host. The real host is
  never written in the repository.

## Out of scope

- The Debian package (`.deb`) that installs the unit. It needs changes to
  `packaging/build-deb.js` and the DEBIAN files, which this task does not allow.
- The API and the real OIDC flow. The API's cookies on the `/api` vhost (K-10).
- Changes to the web app, except the fix of one flaky test (see tasks).
