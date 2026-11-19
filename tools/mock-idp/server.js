'use strict';

// Mock OpenID Connect identity provider for development and tests. It is a
// small authorization code server with PKCE, a login page that lists synthetic
// users, and an in-memory signing key that is created at start and never saved.
// It is not secure and must never face a network. It binds to loopback only.
//
// Run:  node tools/mock-idp/server.js
// Environment (all optional):
//   MOCK_IDP_PORT           listen port, default 4010
//   MOCK_IDP_CLIENT_ID      registered client id, default doctor7-local
//   MOCK_IDP_REDIRECT_URIS  comma-separated exact redirect URIs,
//                           default http://127.0.0.1:3000/auth/callback

const http = require('node:http');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const CODE_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const KEY_ID = 'mock-idp-key-1';

// Synthetic people only. The .test domain is reserved and never resolves.
const DEFAULT_USERS = [
  { sub: 'mock-ana', name: 'Ana Rivera', email: 'ana.rivera@example.test', emailVerified: true },
  { sub: 'mock-luis', name: 'Luis Mora', email: 'luis.mora@example.test', emailVerified: true },
  { sub: 'mock-marta', name: 'Marta Solis', email: 'marta.solis@example.test', emailVerified: true },
  // Verified at the provider, but meant to have no row in the Doctor7 users table.
  { sub: 'mock-norole', name: 'No Role', email: 'no.role@example.test', emailVerified: true },
  // The provider reports this address as not verified.
  { sub: 'mock-pending', name: 'Pending Verify', email: 'pending@example.test', emailVerified: false },
];

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

function sendJson(res, status, value) {
  send(res, status, { 'Content-Type': 'application/json' }, JSON.stringify(value));
}

function sendHtml(res, status, html) {
  send(
    res,
    status,
    {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
    html
  );
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
} = {}) {
  const codes = new Map();
  let signingKey;
  let foreignKey;
  let publicJwk;
  let jose;
  let server = null;

  const idp = {
    issuer: '',
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
      idp.issuer = `http://${HOST}:${server.address().port}`;
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
    const buttons = users
      .map(
        (user) =>
          `<li><button type="submit" name="user" value="${escapeHtml(user.sub)}">` +
          `${escapeHtml(user.name)} (${escapeHtml(user.email)})</button></li>`
      )
      .join('\n');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock identity provider</title>
<style>body{font-family:sans-serif;max-width:32rem;margin:2rem auto}li{margin:.5rem 0;list-style:none}button{width:100%;padding:.6rem;text-align:left}</style>
</head><body>
<h1>Mock identity provider</h1>
<p>Development only. Pick a synthetic user to sign in.</p>
<form method="post" action="/authorize">
${hidden}
<ul>
${buttons}
</ul>
</form>
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
    const url = new URL(req.url, idp.issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      sendJson(res, 200, discoveryDocument());
    } else if (req.method === 'GET' && url.pathname === '/jwks.json') {
      sendJson(res, 200, { keys: [publicJwk] });
    } else if (url.pathname === '/authorize') {
      await handleAuthorize(req, res, url);
    } else if (url.pathname === '/token') {
      await handleToken(req, res);
    } else {
      sendJson(res, 404, { error: 'not_found' });
    }
  }

  return idp;
}

module.exports = { createMockIdp, DEFAULT_USERS };

if (require.main === module) {
  const port = Number(process.env.MOCK_IDP_PORT || 4010);
  const idp = createMockIdp({
    clientId: process.env.MOCK_IDP_CLIENT_ID || 'doctor7-local',
    redirectUris: (process.env.MOCK_IDP_REDIRECT_URIS || 'http://127.0.0.1:3000/auth/callback')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean),
  });
  idp.start({ port }).then(
    () => process.stdout.write(`mock identity provider listening on ${idp.issuer}\n`),
    (err) => {
      process.stderr.write(`mock identity provider failed: ${err.message}\n`);
      process.exitCode = 1;
    }
  );
}
