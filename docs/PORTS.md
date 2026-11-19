# Ports

Every network flow of a doctor7-onprem installation. Host names are examples.
Ports in the "Port" column are defaults. The note under the table says which
setting changes each one.

| Source | Destination | Port | Protocol | Purpose |
|---|---|---|---|---|
| Browser | Apache | 80 | TCP (HTTP) | Redirect to HTTPS. |
| Browser | Apache | 443 | TCP (HTTPS) | Web application, `/api/` requests, sign-in redirects. |
| Browser | Apache | 443 | TCP (WSS) | Chat WebSocket on `/ws`. |
| Apache | API | 3000 | TCP (HTTP) | Proxy of `/api/`, with the prefix removed. The API listens on `127.0.0.1`. |
| Apache | API | 3000 | TCP (WebSocket) | Proxy of `/ws` through `mod_proxy_wstunnel`. |
| API | MariaDB | 3306 | TCP | Application queries and migrations. |
| Backup tools | MariaDB | 3306 | TCP | `doctor7-backup db` and `doctor7-restore db`, run on the API host. |
| API | Identity provider | 443 | TCP (HTTPS) | OIDC discovery, token exchange, key set. |
| API | `meet.googleapis.com` | 443 | TCP (HTTPS) | Create Google Meet spaces. Only with `VIDEO_PROVIDER=meet`. |
| API | `oauth2.googleapis.com` | 443 | TCP (HTTPS) | Service account access token. Only with `VIDEO_PROVIDER=meet`. |
| Browser | Jitsi server | 443 | TCP (HTTPS, WSS) | Jitsi page in the `iframe` and its signaling. Only with Jitsi. |
| Browser | Jitsi videobridge | 10000 | UDP | Jitsi audio and video. Only with Jitsi. |
| Browser | Jitsi videobridge | 4443 | TCP | Jitsi media fallback when UDP is blocked. Only with Jitsi. |
| Browser | Jitsi TURN server | 3478 | UDP | STUN and TURN, when the Jitsi installation has one. |
| Browser | Jitsi TURN server | 5349 | TCP (TLS) | TURN over TLS, when the Jitsi installation has one. |
| Browser | Google Meet | 443 | TCP (HTTPS) | The Meet link opens in a new tab. Media ports are Google's. See Google's network requirements. |
| Administrator | Server | 22 | TCP (SSH) | Installation, upgrade, backup. |

## Notes

- The API never opens a connection to the Jitsi server. It only builds the
  meeting address, and signs a token when `JITSI_APP_ID` is set. The Jitsi
  server may run on another host. The rows for Jitsi describe what the
  browser needs. Ports between the Jitsi components belong to the Jitsi
  installation and are not listed here.
- The API port is `PORT` in `/etc/doctor7/api.env`. The same address and port
  go into `API_UPSTREAM` in `/etc/doctor7/web.vars.conf`.
- MariaDB runs on its own node or service. Allow port 3306 only from the API
  host. This package does not open it.
- Open to the Internet: 80, 443 (Apache), and the Jitsi ports when Jitsi is
  used. Keep 3000, 3306 and 22 closed to the Internet.
- The `connect-src` and `frame-src` rules of the content policy allow only the
  site itself (`wss://${SERVER_NAME}`) and the Jitsi origin. A different
  address for either one needs a change in `web.vars.conf`.
