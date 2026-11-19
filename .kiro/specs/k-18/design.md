# K-18 Design: the mock provider behind Apache

## Shape of the change

Only the mock provider learns about a public prefix. The API, the OIDC client,
and the cookies do not change. The API checks the issuer string, the signature,
the audience, and the nonce, as it does today.

```
browser --https--> Apache (demo host, /idp/) --strip /idp--> 127.0.0.1:4010
API (OIDC_ISSUER = https://<host>/idp)  --https--> Apache --> provider
```

## Provider (`tools/mock-idp/server.js`)

Options added to `createMockIdp`:

| Option | Default | Meaning |
| --- | --- | --- |
| `publicUrl` | none | Public issuer. Sets the prefix and the advertised URLs. |
| `rateLimit` | none | `{ windowMs, loginPageMax, tokenMax }`. No limit when unset. |
| `trustForwardedFor` | `false` | Use the last `X-Forwarded-For` value as the client IP. |

`idp.localUrl` is the loopback origin, for tests and the listener. `idp.issuer`
is the advertised issuer: the public URL when set, otherwise the loopback origin.

`parsePublicUrl(raw)` checks R5 and returns the path prefix (`/idp`, or `''`).
`configFromEnv(env)` turns the environment into options. The entry point uses
it, so tests can check the environment mapping without starting a process.

Routing: `handle()` removes the prefix from `url.pathname` when it matches
`publicPath` exactly or as a leading segment. The paths then match as before.
Without a prefix the path is unchanged, so both forms work (R2).

The login page form uses `${idp.issuer}/authorize` as its action. The old
relative action would send the browser to the root of the demo host, not to
the provider (R12). The CSP gains `form-action 'self'`, and the page keeps
`default-src 'none'`.

Users and roles: `DEFAULT_USERS` gains `mock-iris`. `DEMO_ROLES` maps each
`sub` to a role code (`professional`, `client`, `admin`, `auditor`, or `none`).
Labels: Professional, Client, Administrator, Auditor, No access. The codes match
the seed (K-09). A test compares the page with `seed/lib/generator.js`.

## Rate limit (`tools/mock-idp/rate-limit.js`)

A fixed window per key. `hit(key)` returns whether the request is allowed and,
when it is not, the seconds to wait. Expired windows are removed when the map
grows past a fixed size, so memory stays bounded. The limit applies to
`GET`/`POST /authorize` (`loginPageMax`) and `POST /token` (`tokenMax`).

## Demo mode defaults (entry point only)

When `MOCK_IDP_PUBLIC_URL` is set, the entry point sets `trustForwardedFor` and
`rateLimit` to `{ windowMs: 60000, loginPageMax: 120, tokenMax: 60 }`. Tests
pass their own values. Without the variable, the behavior is the same as before.

## Security notes

- The provider listens on `127.0.0.1` only. Apache is the only path from the
  network. Trusting `X-Forwarded-For` is therefore safe only with Apache in
  front, which is why it is tied to demo mode.
- Apache must keep `ProxyAddHeaders On` (the default). Apache appends the real
  client address, so the last value is the one to trust.
- The provider signs tokens with a key that exists only in memory, as before.
- The demo host name and the TLS files live in the deployment, not the repo.

## systemd and Apache files

- `packaging/systemd/doctor7-mock-idp.service`: user `doctor7-idp`,
  `EnvironmentFile=/etc/doctor7/idp-demo.env` (holds `MOCK_IDP_PUBLIC_URL`,
  `MOCK_IDP_REDIRECT_URIS`, `MOCK_IDP_CLIENT_ID`), hardening directives, no
  host name. `[Install]` exists so an administrator can enable it by hand.
- `packaging/apache/idp-demo.conf.example`: one `ProxyPass /idp/`, one
  `ProxyPassReverse`, and a default deny for `/`.

## Tests

- `tools/mock-idp/server.test.js` (existing) must keep passing.
- `tools/mock-idp/demo.test.js`: prefix, loopback-only listener, both path forms,
  page escaping, role table and seed cross-check, rate limit, env parsing.
- `tools/mock-idp/demo-flow.test.js`: full flow through a fake Apache (strips
  `/idp`), then `createOidcClient` from `api/src/auth/oidc.js` verifies the
  token. `globalThis.fetch` is replaced for the test, because `jose` fetches the
  JWKS with the global fetch.
- `tools/mock-idp/demo-docs.test.js`: `docs/DEMO.md` warns against production.
- `packaging/systemd/doctor7-mock-idp.test.js` and
  `packaging/apache/idp-demo.test.js`: static checks of the two files.

## Flaky test (`web/src/pages/AppointmentPage.test.jsx`)

The chat tests wait for the "Chat" heading and then read the WebSocket that
`ChatPanel` creates in an effect. The heading can appear before that effect
runs, so the test can read no socket or the previous one. The fix waits for the
socket itself (`waitFor` on `FakeWebSocket.instances`). The timeout stays as is.
