# doctor7-onprem API contract

This document lists every HTTP endpoint of the API, with its method, path,
allowed roles, and an example. Clients and the front end depend on it.

Status: skeleton. Only the two probe endpoints exist. Later tasks add the
domain endpoints and fill in the allowed roles for them.

## Conventions

- Format: JSON in UTF-8. Send request bodies with `Content-Type: application/json`.
- Timestamps: ISO 8601 in UTC with milliseconds, for example `2026-11-19T03:26:00.123Z`.
- Errors: every error response has this shape:

  ```json
  {"error":{"code":"not_found","message":"Route not found."}}
  ```

  Responses never include stack traces, SQL text, or database driver messages.
- Pagination: list endpoints accept `limit` (default 50, maximum 200) and
  `offset` (default 0).
- Rate limit: 120 requests per client IP per 60 seconds by default. Set
  `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` to change it. A request over the
  limit gets `429` with code `rate_limited`.
- Security headers: every response carries the headers set by helmet, including
  `Content-Security-Policy`, `Strict-Transport-Security`, and
  `X-Content-Type-Options: nosniff`. The `X-Powered-By` header is removed.
- Roles: the values stored in `users.role` are `professional`, `client`,
  `admin`, and `auditor`.

## Endpoints

| Method | Path | Allowed roles | Description |
|---|---|---|---|
| GET | `/healthz` | Public, no authentication | Liveness. Returns `ok` without querying the database. |
| GET | `/readyz` | Public, no authentication | Readiness. Returns `503` when the database does not answer `SELECT 1`. |

### GET /healthz

Request:

```sh
curl -i http://127.0.0.1:3000/healthz
```

Response `200`:

```json
{"status":"ok"}
```

### GET /readyz

Request:

```sh
curl -i http://127.0.0.1:3000/readyz
```

Response `200`:

```json
{"status":"ready"}
```

Response `503` when the database is down:

```json
{"error":{"code":"database_unavailable","message":"Database is not reachable."}}
```

## Error codes

| HTTP status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | The request body is not valid JSON. |
| 404 | `not_found` | No route matches the path. |
| 413 | `payload_too_large` | The request body is larger than 100 KB. |
| 429 | `rate_limited` | The client exceeded the rate limit. |
| 500 | `internal_error` | An unexpected failure. The details are in the server log only. |
| 503 | `database_unavailable` | The database did not answer the readiness check. |
