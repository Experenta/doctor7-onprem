'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const demo = fs.readFileSync(path.join(ROOT, 'docs', 'DEMO.md'), 'utf8');

test('DEMO.md says the demo must not be installed in production', () => {
  assert.match(demo, /Do not install this on a production server/);
  assert.match(demo, /Demo only/);
});

test('DEMO.md names the variables and the unit and vhost files', () => {
  for (const name of [
    'MOCK_IDP_PUBLIC_URL',
    'MOCK_IDP_REDIRECT_URIS',
    'MOCK_IDP_CLIENT_ID',
    'OIDC_ISSUER',
    'doctor7-mock-idp.service',
    'idp-demo.conf.example',
  ]) {
    assert.ok(demo.includes(name), name);
  }
});

test('DEMO.md keeps the host name out of the repository, and uses only reserved names', () => {
  // Only the placeholder, the demo name, and loopback addresses may appear as hosts.
  const urls = [...demo.matchAll(/https?:\/\/([^\s/`)'"]+)/g)].map((match) => match[1]);
  for (const host of urls) {
    assert.ok(
      ['<host>', 'demo.example.test', '127.0.0.1', 'localhost'].includes(host),
      `unexpected host in DEMO.md: ${host}`
    );
  }
  for (const [, domain] of demo.matchAll(/[\w.+-]+@([\w.-]+)/g)) {
    assert.ok(domain === 'example.test' || domain.endsWith('.example.test'), `unexpected domain: ${domain}`);
  }
});

test('DEMO.md states that the data is synthetic and resets', () => {
  assert.match(demo, /synthetic/i);
  assert.match(demo, /reset/i);
});
