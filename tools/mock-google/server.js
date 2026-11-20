'use strict';

// Mock of the two Google endpoints the Meet adapter uses: the OAuth token
// endpoint (service account assertion, domain-wide delegation) and the Meet
// REST "create space" endpoint. It is for development and tests only. It never
// contacts Google, binds to loopback, and keeps everything in memory.
//
// The caller gives the PUBLIC key that matches the test service account. The
// mock verifies the RS256 signature of each assertion with it. It records
// method, path, and status of each request, never a body or a token.
//
// Run:  node tools/mock-google/server.js
// Environment:
//   MOCK_GOOGLE_PUBLIC_KEY_FILE  required, PEM file with the test public key
//   MOCK_GOOGLE_PORT             optional, listen port, default 4020
//   MOCK_GOOGLE_CONTROL_SECRET   optional, turns on the demo control endpoint (see below)
//
// Demo control (K-36). With a control secret, GET and POST /control/mode read and set `mode`.
// It accepts a peer on loopback only, a request without X-Forwarded-For or Forwarded, and the
// header x-demo-control-secret. POST takes {"mode":"ok"} or {"mode":"http_500"}. Without a
// secret the paths answer 404, like any other unknown path. The secret is never logged.
//
// `mode` drives the answer of the Meet endpoint and the token endpoint:
//   ok                 token and space are created.
//   http_400           the space endpoint answers 400.
//   http_500           the space endpoint answers 500.
//   quota              the space endpoint answers 429 RESOURCE_EXHAUSTED.
//   hang               the space endpoint never answers.
//   no_uri             the space endpoint answers 200 without meetingUri.
//   delegation_denied  the token endpoint answers 401 unauthorized_client.

const http = require('node:http');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 16 * 1024;
const SPACE_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const MODES = Object.freeze(['ok', 'http_400', 'http_500', 'quota', 'hang', 'no_uri', 'delegation_denied']);
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// The only modes the demo control may set.
const CONTROL_MODES = Object.freeze(['ok', 'http_500']);
const CONTROL_PATH = '/control/mode';
const CONTROL_HEADER = 'x-demo-control-secret';
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

// Compares two secrets in constant time, whatever their length.
function sameSecret(given, expected) {
  return crypto.timingSafeEqual(sha256(given), sha256(expected)) && typeof given === 'string';
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Returns the claims of a valid RS256 JWT, or null.
function verifyAssertion(token, publicKeyPem) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256') return null;
    const valid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKeyPem,
      Buffer.from(parts[2], 'base64url')
    );
    return valid ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) : null;
  } catch {
    return null;
  }
}

function randomCode() {
  const pick = (count) =>
    Array.from(crypto.randomBytes(count), (byte) => LETTERS[byte % LETTERS.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

function createMockGoogle({
  publicKeyPem,
  serviceAccountEmail = 'meet-sa@doctor7-test.example.test',
  delegatedUsers = ['clinic.organizer@example.test'],
  now = () => new Date(),
  controlSecret,
} = {}) {
  if (typeof publicKeyPem !== 'string' || publicKeyPem.length === 0) {
    throw new TypeError('createMockGoogle requires publicKeyPem.');
  }
  if (controlSecret !== undefined && (typeof controlSecret !== 'string' || controlSecret.length < 16)) {
    throw new TypeError('controlSecret must be a string of at least 16 characters.');
  }
  const accessTokens = new Set();
  let server = null;

  const google = {
    issuer: '',
    mode: 'ok',
    // { method, path, status } per request. No bodies, no tokens.
    requests: [],
    spaces: [],
    reset() {
      google.mode = 'ok';
      google.requests.length = 0;
      google.spaces.length = 0;
    },
    async start({ port = 0 } = {}) {
      server = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) send(res, 500, { error: { code: 500, status: 'INTERNAL' } });
          else res.end();
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, resolve);
      });
      google.issuer = `http://${HOST}:${server.address().port}`;
      return google;
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

  function answer(req, res, path, status, value) {
    google.requests.push({ method: req.method, path, status });
    send(res, status, value);
  }

  async function handleToken(req, res, path) {
    const form = new URLSearchParams(await readBody(req));
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      return answer(req, res, path, 400, { error: 'unsupported_grant_type' });
    }
    if (google.mode === 'delegation_denied') {
      return answer(req, res, path, 401, {
        error: 'unauthorized_client',
        error_description: 'Client is unauthorized to retrieve access tokens using this method.',
      });
    }
    const claims = verifyAssertion(form.get('assertion'), publicKeyPem);
    const nowSeconds = Math.floor(now().getTime() / 1000);
    const scopes = claims && typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
    const valid =
      claims &&
      claims.iss === serviceAccountEmail &&
      delegatedUsers.includes(claims.sub) &&
      scopes.includes(SPACE_SCOPE) &&
      claims.aud === `${google.issuer}/token` &&
      Number.isFinite(claims.exp) &&
      claims.exp > nowSeconds;
    if (!valid) {
      return answer(req, res, path, 400, { error: 'invalid_grant' });
    }
    const accessToken = crypto.randomBytes(24).toString('base64url');
    accessTokens.add(accessToken);
    return answer(req, res, path, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300 });
  }

  async function handleSpaces(req, res, path) {
    await readBody(req);
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!accessTokens.has(token)) {
      return answer(req, res, path, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    }
    if (google.mode === 'hang') {
      google.requests.push({ method: req.method, path, status: 0 });
      return undefined; // no answer, on purpose
    }
    if (google.mode === 'http_400') {
      return answer(req, res, path, 400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
    }
    if (google.mode === 'http_500') {
      return answer(req, res, path, 500, { error: { code: 500, status: 'INTERNAL' } });
    }
    if (google.mode === 'quota') {
      return answer(req, res, path, 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
    }
    if (google.mode === 'no_uri') {
      return answer(req, res, path, 200, { name: 'spaces/none' });
    }
    const code = randomCode();
    const space = { name: `spaces/${crypto.randomBytes(6).toString('hex')}`, meetingCode: code, meetingUri: `https://meet.google.com/${code}` };
    google.spaces.push(space);
    return answer(req, res, path, 200, space);
  }

  // Demo control. Every refusal is recorded with method, path, and status only.
  async function handleControl(req, res, path) {
    if (!LOOPBACK_PEERS.has(req.socket.remoteAddress) || req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) {
      return answer(req, res, path, 403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
    }
    if (!sameSecret(req.headers[CONTROL_HEADER], controlSecret)) {
      return answer(req, res, path, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    }
    if (req.method === 'GET') {
      return answer(req, res, path, 200, { mode: google.mode });
    }
    if (req.method !== 'POST') {
      return answer(req, res, path, 405, { error: { code: 405, status: 'METHOD_NOT_ALLOWED' } });
    }
    let mode;
    try {
      mode = JSON.parse(await readBody(req)).mode;
    } catch {
      mode = undefined;
    }
    if (typeof mode !== 'string' || !CONTROL_MODES.includes(mode)) {
      return answer(req, res, path, 400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
    }
    google.mode = mode;
    return answer(req, res, path, 200, { mode: google.mode });
  }

  async function handle(req, res) {
    const path = new URL(req.url, google.issuer).pathname;
    if (controlSecret !== undefined && path === CONTROL_PATH) {
      await handleControl(req, res, path);
    } else if (req.method === 'POST' && path === '/token') {
      await handleToken(req, res, path);
    } else if (req.method === 'POST' && path === '/v2/spaces') {
      await handleSpaces(req, res, path);
    } else {
      answer(req, res, path, 404, { error: { code: 404, status: 'NOT_FOUND' } });
    }
  }

  return google;
}

module.exports = { createMockGoogle, MODES, CONTROL_MODES, CONTROL_PATH, CONTROL_HEADER, SPACE_SCOPE };

if (require.main === module) {
  const keyFile = process.env.MOCK_GOOGLE_PUBLIC_KEY_FILE;
  if (!keyFile) {
    process.stderr.write('Set MOCK_GOOGLE_PUBLIC_KEY_FILE to the PEM file of the test public key.\n');
    process.exit(1);
  }
  const google = createMockGoogle({
    publicKeyPem: require('node:fs').readFileSync(keyFile, 'utf8'),
    controlSecret: process.env.MOCK_GOOGLE_CONTROL_SECRET || undefined,
  });
  google.start({ port: Number(process.env.MOCK_GOOGLE_PORT || 4020) }).then(
    () => process.stdout.write(`mock Google listening on ${google.issuer}\n`),
    (err) => {
      process.stderr.write(`mock Google failed: ${err.message}\n`);
      process.exitCode = 1;
    }
  );
}
