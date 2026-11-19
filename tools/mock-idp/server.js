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
<style>
:root{--heading:#5E60CE;--primary:#7400b8;--primary-border:#bca5eb;--ink:#1f1b2e;--muted:#4f4763;--surface:#ffffff;--tint:#f4f0fb;--line:#d8cdee}
*{box-sizing:border-box}
body{margin:0;background:var(--tint);color:var(--ink);font-family:Lato,Arial,Helvetica,sans-serif;font-size:1rem;line-height:1.5}
.wrap{max-width:40rem;margin:0 auto;padding:1.5rem 1rem 2.5rem}
h1{font-family:Montserrat,Arial,Helvetica,sans-serif;color:var(--heading);font-size:1.5rem;font-weight:700;line-height:1.25;margin:0 0 1rem}
p{margin:0 0 1rem;max-width:70ch}
.notice{background:var(--surface);border:1px solid var(--primary-border);border-radius:8px;padding:1rem;margin:0 0 1.25rem;box-shadow:0 1px 3px rgba(31,27,46,.08)}
.notice p{margin:0}
.accounts{list-style:none;margin:0 0 1.25rem;padding:0;display:grid;gap:.75rem}
.account{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:1rem;box-shadow:0 1px 3px rgba(31,27,46,.08)}
.account-name{font-weight:700;margin:0}
.account-meta{margin:.25rem 0 .75rem;color:var(--muted);font-size:.9375rem;overflow-wrap:anywhere}
.role{font-weight:700;color:var(--primary)}
.role-none{color:var(--muted)}
button{display:block;width:100%;min-height:44px;padding:.625rem 1rem;border:1px solid var(--primary);border-radius:6px;background:var(--primary);color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:hover{text-decoration:underline}
button:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
::selection{background:var(--primary-border);color:var(--ink)}
.muted{color:var(--muted)}
</style>
</head><body>
<main class="wrap">
<h1>Sign in to the doctor7 demo</h1>
<div class="notice" role="note">
<p><strong>Demonstration only.</strong> These are synthetic demonstration accounts. Their data is invented and resets regularly. Do not enter real personal information.</p>
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
