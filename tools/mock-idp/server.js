'use strict';

// Mock OpenID Connect identity provider for development, tests, and the public
// demo. It is a small authorization code server with PKCE, a login page that
// lists synthetic users, and an in-memory signing key that is created at start
// and never saved. It is not secure and must never be used in production. It
// binds to loopback only. In the demo, Apache forwards a public path to it.
//
// Run:  node tools/mock-idp/server.js
// Environment (all optional):
//   MOCK_IDP_PORT           listen port, default 4010
//   MOCK_IDP_CLIENT_ID      registered client id, default doctor7-local
//   MOCK_IDP_REDIRECT_URIS  comma-separated exact redirect URIs,
//                           default http://127.0.0.1:3000/auth/callback
//   MOCK_IDP_PUBLIC_URL     public issuer behind a reverse proxy, such as
//                           https://<host>/idp. When set, the advertised URLs use
//                           it, the paths also work without the prefix, and the
//                           rate limits and forwarded-address handling are on.

const http = require('node:http');
const crypto = require('node:crypto');
const { createRateLimiter } = require('./rate-limit');

const HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_PORT = 4010;
const CODE_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const KEY_ID = 'mock-idp-key-1';

// Synthetic people only. The .test domain is reserved and never resolves.
const DEFAULT_USERS = [
  { sub: 'mock-ana', name: 'Ana Rivera', email: 'ana.rivera@example.test', emailVerified: true },
  { sub: 'mock-luis', name: 'Luis Mora', email: 'luis.mora@example.test', emailVerified: true },
  { sub: 'mock-marta', name: 'Marta Solis', email: 'marta.solis@example.test', emailVerified: true },
  { sub: 'mock-iris', name: 'Iris Vega', email: 'iris.vega@example.test', emailVerified: true },
  // Verified at the provider, but meant to have no row in the Doctor7 users table.
  { sub: 'mock-norole', name: 'No Role', email: 'no.role@example.test', emailVerified: true },
  // The provider reports this address as not verified.
  { sub: 'mock-pending', name: 'Pending Verify', email: 'pending@example.test', emailVerified: false },
];

// Role of each account on the login page. The codes match the role values of the
// synthetic seed (seed/lib/generator.js, K-09). 'none' is shown as "No access".
const DEMO_ROLES = Object.freeze({
  'mock-ana': 'professional',
  'mock-luis': 'client',
  'mock-marta': 'admin',
  'mock-iris': 'auditor',
  'mock-norole': 'none',
  'mock-pending': 'none',
});

const ROLE_LABELS = Object.freeze({
  professional: 'Professional',
  client: 'Client',
  admin: 'Administrator',
  auditor: 'Auditor',
  none: 'No access',
});

// Demo limits: requests per window and per client address.
const DEMO_RATE_LIMIT = Object.freeze({ windowMs: 60 * 1000, loginPageMax: 120, tokenMax: 60 });

const CSP_PAGE = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Initials for the avatar of an account: the first letters of the first and the last word of
// the name, or the first two letters of a single word. Only letters and digits are used.
function initialsOf(name) {
  const words = String(name || '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

// The style of the sign-in page. The page lives in the world of the web client: a left panel
// with the brand gradient, a pale canvas, purple structure, turquoise as light, and one
// magenta notice. The colors repeat tokens.css of the web client, because this page cannot
// import it, and login-page.test.js compares the two. The page asks for nothing outside
// itself: the content security policy allows an inline style and nothing else, so there is
// no font file, no image, and no script. The fonts are the ones of the system.
const LOGIN_CSS = `
:root{--purple-950:#1E0F52;--purple-900:#2A1466;--purple-700:#482494;--purple-500:#6E4FC9;--purple-100:#ECE7F8;--purple-50:#F6F4FC;--turquoise-500:#18E4DC;--on-turquoise:#0B2A28;--magenta-600:#D800B0;--magenta-800:#9C0081;--magenta-100:#FBE1F6;--ink:#1B1535;--muted:#5C5778;--line:#E4DFF2;--white:#FFFFFF;--on-dark-muted:#CFC5EE;--gradient:linear-gradient(135deg,var(--purple-700),var(--magenta-600));--shadow:0 2px 12px rgba(30,15,82,.12);--shadow-raised:0 8px 24px rgba(30,15,82,.2);--motion:180ms}
*{box-sizing:border-box}
body{margin:0;background:var(--purple-50);color:var(--ink);font-family:"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;font-size:1rem;line-height:1.55;caret-color:var(--purple-700)}
::selection{background:var(--purple-100);color:var(--ink)}
.page{display:grid;min-height:100vh}
.band{display:flex;flex-direction:column;justify-content:space-between;gap:2rem;padding:1.5rem 1.25rem 2rem;background:var(--gradient);color:var(--white)}
.brand{display:flex;align-items:center;gap:.75rem}
.glyph{width:2.5rem;height:2.5rem;flex:none}
.glyph-tile{fill:var(--purple-950);stroke:var(--purple-500);stroke-width:1}
.glyph-stroke{fill:none;stroke:var(--white);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.glyph-dot{fill:var(--turquoise-500)}
.logotype{font-size:1.75rem;font-weight:800;letter-spacing:.01em;line-height:1}
.logotype-seven{color:var(--turquoise-500)}
.pitch{margin:0 0 .75rem;max-width:20ch;font-size:1.44rem;font-weight:800;line-height:1.25}
.band-text{margin:0;max-width:34ch}
.wrap{width:100%;max-width:46rem;margin:0 auto;padding:1.5rem 1rem 2.5rem}
h1{margin:0 0 1rem;color:var(--purple-900);font-size:1.5rem;font-weight:800;line-height:1.25}
p{margin:0 0 1rem;max-width:70ch}
.notice{display:flex;gap:.75rem;align-items:flex-start;margin:0 0 1.25rem;padding:.875rem 1rem;border:1px solid var(--magenta-600);border-radius:12px;background:var(--magenta-100)}
.notice svg{flex:none;width:1.25rem;height:1.25rem;margin-top:.15rem;fill:none;stroke:var(--magenta-800);stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.notice p{margin:0}
.notice strong{color:var(--magenta-800)}
.accounts{list-style:none;margin:0 0 1.25rem;padding:0;display:grid;gap:.875rem;grid-template-columns:minmax(0,1fr)}
.account{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:.875rem;row-gap:.125rem;align-items:start;align-content:start;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--white);box-shadow:var(--shadow);transition:box-shadow var(--motion)}
.account:hover{box-shadow:var(--shadow-raised)}
.avatar{grid-row:1 / span 2;display:grid;place-items:center;width:3rem;height:3rem;border-radius:50%;background:var(--purple-700);color:var(--white);font-size:1rem;font-weight:800;letter-spacing:.02em}
.avatar-client{background:var(--turquoise-500);color:var(--on-turquoise)}
.avatar-admin{background:var(--purple-950)}
.avatar-auditor{background:var(--purple-500)}
.avatar-none{background:var(--purple-100);color:var(--ink)}
.account-name{margin:0;font-weight:800;overflow-wrap:anywhere}
.account-meta{display:grid;justify-items:start;gap:.25rem;margin:0 0 .25rem;color:var(--muted);font-size:.9375rem;overflow-wrap:anywhere}
.role{display:inline-block;padding:0 .625rem;border-radius:999px;background:var(--purple-100);color:var(--purple-700);font-size:.875rem;font-weight:700;line-height:1.5}
.role-none{background:var(--line);color:var(--ink)}
button{grid-column:1 / -1;display:block;width:100%;min-height:44px;margin-top:.5rem;padding:.625rem 1rem;border:1px solid var(--purple-700);border-radius:12px;background:var(--purple-700);color:var(--white);font:inherit;font-weight:700;cursor:pointer;transition:background-color var(--motion),box-shadow var(--motion)}
button:hover{background:var(--purple-900);border-color:var(--purple-900)}
button:active{background:var(--purple-950);border-color:var(--purple-950)}
button:focus-visible{outline:3px solid var(--purple-500);outline-offset:2px}
.muted{color:var(--muted)}
@media (min-width:640px){.band{padding:2rem 2rem 2.5rem}}
@media (min-width:640px) and (max-width:859px){.accounts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:860px){.page{grid-template-columns:2fr 3fr}.band{position:sticky;top:0;height:100vh;padding:2.5rem 2.5rem 3rem}.pitch{font-size:1.728rem}.wrap{margin:0;padding:2.5rem 2.5rem 3rem}}
@media (min-width:1240px){.accounts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// The glyph of the brand: a tile with a stroke and a dot. It is drawn here as inline SVG.
const LOGIN_GLYPH =
  '<svg class="glyph" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
  '<rect class="glyph-tile" x="1" y="1" width="30" height="30" rx="9"/>' +
  '<path class="glyph-stroke" d="M10 11h12l-6.5 11"/>' +
  '<circle class="glyph-dot" cx="22.5" cy="23" r="2.2"/></svg>';

// A small alert sign for the notice, in the same single-stroke style as the web client.
const NOTICE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4l9 16H3zM12 10v4M12 17h.01"/></svg>';

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function s256(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function send(res, status, headers, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, { ...headers, 'Content-Type': 'application/json' }, JSON.stringify(value));
}

function sendHtml(res, status, html, headers = {}) {
  send(
    res,
    status,
    {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP_PAGE,
      'X-Content-Type-Options': 'nosniff',
    },
    html
  );
}

// Checks MOCK_IDP_PUBLIC_URL and returns the issuer as given, plus the path prefix
// ('' or, for example, '/idp'). The API compares OIDC_ISSUER with the issuer as a
// string, so the value is never rewritten.
function parsePublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MOCK_IDP_PUBLIC_URL must be an absolute URL.');
  }
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('MOCK_IDP_PUBLIC_URL must use https (http is allowed only for localhost).');
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('MOCK_IDP_PUBLIC_URL must not contain a query, a fragment, or credentials.');
  }
  if (raw.endsWith('/')) {
    throw new Error('MOCK_IDP_PUBLIC_URL must not end with a slash.');
  }
  return { issuer: raw, prefix: url.pathname === '/' ? '' : url.pathname };
}

// Maps the environment to createMockIdp options. Demo mode (MOCK_IDP_PUBLIC_URL
// set) turns on the limits and trusts the forwarded address set by Apache.
function configFromEnv(env = process.env) {
  const port = env.MOCK_IDP_PORT ? Number(env.MOCK_IDP_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('MOCK_IDP_PORT must be a port number.');
  }
  const options = {
    clientId: env.MOCK_IDP_CLIENT_ID || 'doctor7-local',
    redirectUris: (env.MOCK_IDP_REDIRECT_URIS || 'http://127.0.0.1:3000/auth/callback')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean),
  };
  if (env.MOCK_IDP_PUBLIC_URL) {
    options.publicUrl = env.MOCK_IDP_PUBLIC_URL;
    options.rateLimit = DEMO_RATE_LIMIT;
    options.trustForwardedFor = true;
  }
  return { port, options };
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

const AUTHORIZE_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
];

function createMockIdp({
  clientId = 'doctor7-local',
  clientSecret = '',
  redirectUris = ['http://127.0.0.1:3000/auth/callback'],
  users = DEFAULT_USERS,
  tokenTtlSeconds = 300,
  now = () => new Date(),
  // Test hook: (claims, { user, clientId }) => claims. It can change or remove claims.
  tamperClaims = null,
  // Public issuer behind a reverse proxy. Null keeps the loopback issuer.
  publicUrl = null,
  // { windowMs, loginPageMax, tokenMax }. Null means no limit.
  rateLimit = null,
  // Use the last X-Forwarded-For value as the client address. Only safe behind a proxy.
  trustForwardedFor = false,
} = {}) {
  const publicBase = publicUrl ? parsePublicUrl(publicUrl) : null;
  const publicPrefix = publicBase ? publicBase.prefix : '';
  const limits = rateLimit
    ? {
        loginPage: createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.loginPageMax, now }),
        token: createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.tokenMax, now }),
      }
    : null;

  const codes = new Map();
  let signingKey;
  let foreignKey;
  let publicJwk;
  let jose;
  let server = null;

  const idp = {
    // The advertised issuer: the public URL when set, otherwise the loopback origin.
    issuer: '',
    // The loopback origin the listener uses. Tests call it directly.
    localUrl: '',
    // Test hook: when true, tokens are signed with a key that is not in the JWKS.
    forgeSignature: false,
    codes,
    async start({ port = 0 } = {}) {
      jose = await import('jose');
      const pair = await jose.generateKeyPair('ES256', { extractable: true });
      signingKey = pair.privateKey;
      foreignKey = (await jose.generateKeyPair('ES256')).privateKey;
      publicJwk = { ...(await jose.exportJWK(pair.publicKey)), kid: KEY_ID, alg: 'ES256', use: 'sig' };

      server = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) {
            sendJson(res, 500, { error: 'server_error' });
          } else {
            res.end();
          }
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, resolve);
      });
      idp.localUrl = `http://${HOST}:${server.address().port}`;
      idp.issuer = publicBase ? publicBase.issuer : idp.localUrl;
      return idp;
    },
    close() {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };

  function discoveryDocument() {
    return {
      issuer: idp.issuer,
      authorization_endpoint: `${idp.issuer}/authorize`,
      token_endpoint: `${idp.issuer}/token`,
      jwks_uri: `${idp.issuer}/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'email', 'profile'],
    };
  }

  // Removes the public prefix that Apache adds, so both forms reach the same route.
  function stripPublicPrefix(pathname) {
    if (!publicPrefix) return pathname;
    if (pathname === publicPrefix) return '/';
    if (pathname.startsWith(`${publicPrefix}/`)) return pathname.slice(publicPrefix.length);
    return pathname;
  }

  // The client address for rate limiting. Behind Apache, the last X-Forwarded-For
  // value is the address that Apache received from the client.
  function clientAddress(req) {
    if (trustForwardedFor) {
      const header = req.headers['x-forwarded-for'];
      if (typeof header === 'string') {
        const last = header.split(',').pop().trim();
        if (last) return last.slice(0, 64);
      }
    }
    return req.socket.remoteAddress || 'unknown';
  }

  // Answers 429 and returns true when the client is over the limit for this route.
  function refuseWhenLimited(req, res, kind) {
    if (!limits) return false;
    const verdict = limits[kind].hit(clientAddress(req));
    if (verdict.allowed) return false;
    const headers = { 'Retry-After': String(verdict.retryAfterSeconds) };
    if (kind === 'loginPage') {
      sendHtml(
        res,
        429,
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Too many requests</title></head>' +
          '<body><p>Too many requests from this address. Wait a minute, then try again.</p></body></html>',
        headers
      );
    } else {
      sendJson(res, 429, { error: 'rate_limited' }, headers);
    }
    return true;
  }

  // Returns an error text, or null when the authorization request is acceptable.
  function checkAuthorizeRequest(params) {
    if (params.get('response_type') !== 'code') return 'response_type must be code';
    if (params.get('client_id') !== clientId) return 'unknown client_id';
    if (!redirectUris.includes(params.get('redirect_uri'))) return 'redirect_uri is not registered';
    if (!params.get('state')) return 'state is required';
    if (!params.get('nonce')) return 'nonce is required';
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(params.get('code_challenge') || '')) {
      return 'code_challenge is required';
    }
    if (params.get('code_challenge_method') !== 'S256') return 'code_challenge_method must be S256';
    return null;
  }

  function loginPage(params) {
    const hidden = AUTHORIZE_FIELDS.map(
      (name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) || '')}">`
    ).join('\n');
    // The action is absolute. A relative action would miss the public prefix.
    const action = escapeHtml(`${idp.issuer}/authorize`);
    const accounts = users
      .map((user) => {
        const code = Object.hasOwn(DEMO_ROLES, user.sub) ? DEMO_ROLES[user.sub] : 'none';
        const roleClass = code === 'none' ? 'role role-none' : 'role';
        return (
          `<li class="account">` +
          `<span class="avatar avatar-${code}" aria-hidden="true">${escapeHtml(initialsOf(user.name))}</span>` +
          `<p class="account-name">${escapeHtml(user.name)}</p>` +
          `<p class="account-meta"><span class="${roleClass}">${escapeHtml(ROLE_LABELS[code])}</span> ` +
          `<span>${escapeHtml(user.email)}</span></p>` +
          `<button type="submit" name="user" value="${escapeHtml(user.sub)}">` +
          `Sign in as ${escapeHtml(user.name)}</button>` +
          `</li>`
        );
      })
      .join('\n');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>doctor7 demo sign-in</title>
<style>${LOGIN_CSS}</style>
</head><body>
<div class="page">
<div class="band">
<div class="brand">${LOGIN_GLYPH}<span class="logotype">Doctor<span class="logotype-seven">7</span></span></div>
<div>
<p class="pitch">Psychological care that your clinic runs on its own server.</p>
<p class="band-text">This is the sign-in page of the demonstration. Choose an account to see the platform from the point of view of its role.</p>
</div>
</div>
<main class="wrap">
<h1>Sign in to the doctor7 demo</h1>
<div class="notice" role="note">
${NOTICE_ICON}
<p><strong>Demonstration only.</strong> These are synthetic demonstration accounts. Their data is invented. Do not enter real personal information.</p>
</div>
<p>Choose an account to sign in. Each account shows its role in the system.</p>
<form method="post" action="${action}">
${hidden}
<ul class="accounts">
${accounts}
</ul>
</form>
<p class="muted">An account marked No access is for testing a refused sign-in. The system is expected to refuse it.</p>
</main>
</div>
</body></html>`;
  }

  async function handleAuthorize(req, res, url) {
    let params;
    if (req.method === 'GET') {
      params = url.searchParams;
    } else if (req.method === 'POST') {
      params = await readForm(req);
    } else {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const problem = checkAuthorizeRequest(params);
    if (problem) {
      // Never redirect with an unvalidated redirect_uri.
      sendHtml(res, 400, `<!doctype html><title>Error</title><p>${escapeHtml(problem)}</p>`);
      return;
    }
    if (req.method === 'GET') {
      sendHtml(res, 200, loginPage(params));
      return;
    }

    const user = users.find((candidate) => candidate.sub === params.get('user'));
    if (!user) {
      sendHtml(res, 400, '<!doctype html><title>Error</title><p>Choose a listed user.</p>');
      return;
    }
    const code = randomToken();
    codes.set(code, {
      clientId,
      redirectUri: params.get('redirect_uri'),
      codeChallenge: params.get('code_challenge'),
      nonce: params.get('nonce'),
      user,
      expiresAt: now().getTime() + CODE_TTL_MS,
    });
    const target = new URL(params.get('redirect_uri'));
    target.searchParams.set('code', code);
    target.searchParams.set('state', params.get('state'));
    send(res, 302, { Location: target.href }, '');
  }

  async function signIdToken(entry) {
    const issuedAt = Math.floor(now().getTime() / 1000);
    let claims = {
      iss: idp.issuer,
      sub: entry.user.sub,
      aud: clientId,
      iat: issuedAt,
      exp: issuedAt + tokenTtlSeconds,
      nonce: entry.nonce,
      email: entry.user.email,
      email_verified: entry.user.emailVerified,
      name: entry.user.name,
    };
    if (tamperClaims) {
      claims = tamperClaims(claims, { user: entry.user, clientId });
    }
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
      .sign(idp.forgeSignature ? foreignKey : signingKey);
  }

  async function handleToken(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const form = await readForm(req);
    const fail = (error) => sendJson(res, 400, { error });

    if (form.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type');
    if (form.get('client_id') !== clientId) return fail('invalid_client');
    if (clientSecret && form.get('client_secret') !== clientSecret) return fail('invalid_client');

    // A code works once, even when the rest of the request is wrong.
    const entry = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    if (!entry || entry.expiresAt < now().getTime()) return fail('invalid_grant');
    if (entry.clientId !== clientId || entry.redirectUri !== form.get('redirect_uri')) {
      return fail('invalid_grant');
    }
    const verifier = form.get('code_verifier') || '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || s256(verifier) !== entry.codeChallenge) {
      return fail('invalid_grant');
    }

    sendJson(res, 200, {
      access_token: randomToken(),
      token_type: 'Bearer',
      expires_in: tokenTtlSeconds,
      id_token: await signIdToken(entry),
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, idp.localUrl);
    const path = stripPublicPrefix(url.pathname);
    if (path === '/authorize' && refuseWhenLimited(req, res, 'loginPage')) {
      return;
    }
    if (path === '/token' && refuseWhenLimited(req, res, 'token')) {
      return;
    }
    if (req.method === 'GET' && path === '/.well-known/openid-configuration') {
      sendJson(res, 200, discoveryDocument());
    } else if (req.method === 'GET' && path === '/jwks.json') {
      sendJson(res, 200, { keys: [publicJwk] });
    } else if (path === '/authorize') {
      await handleAuthorize(req, res, url);
    } else if (path === '/token') {
      await handleToken(req, res);
    } else {
      sendJson(res, 404, { error: 'not_found' });
    }
  }

  return idp;
}

module.exports = {
  createMockIdp,
  configFromEnv,
  parsePublicUrl,
  DEFAULT_USERS,
  DEMO_ROLES,
  ROLE_LABELS,
  DEMO_RATE_LIMIT,
};

if (require.main === module) {
  let idp;
  try {
    const { port, options } = configFromEnv(process.env);
    idp = createMockIdp(options);
    idp.start({ port }).then(
      () => process.stdout.write(`mock identity provider listening on ${idp.localUrl}, issuer ${idp.issuer}\n`),
      (err) => {
        process.stderr.write(`mock identity provider failed: ${err.message}\n`);
        process.exitCode = 1;
      }
    );
  } catch (err) {
    process.stderr.write(`mock identity provider configuration error: ${err.message}\n`);
    process.exitCode = 1;
  }
}
