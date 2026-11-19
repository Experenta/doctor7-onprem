'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vhost = fs.readFileSync(path.join(__dirname, 'idp-demo.conf.example'), 'utf8');

test('the vhost forwards /idp/ to the loopback provider, and nothing else is proxied', () => {
  const proxyPass = vhost.match(/^\s*ProxyPass\s.*$/gm) || [];
  assert.deepEqual(proxyPass.map((line) => line.trim()), ['ProxyPass /idp/ http://127.0.0.1:4010/']);
  assert.match(vhost, /^\s*ProxyPassReverse \/idp\/ http:\/\/127\.0\.0\.1:4010\/$/m);
  assert.match(vhost, /^\s*ProxyRequests Off$/m);
});

test('the vhost refuses every path except /idp/', () => {
  assert.match(vhost, /<Location "\/">\s*Require all denied\s*<\/Location>/);
  assert.match(vhost, /<Location "\/idp\/">\s*Require all granted\s*<\/Location>/);
  // The deny block for "/" comes before the grant for /idp/, so the grant is more specific.
  assert.ok(vhost.indexOf('Require all denied') < vhost.indexOf('Require all granted'));
});

test('the vhost binds to loopback only and names only the demo host', () => {
  const directives = vhost
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const backends = [...directives.matchAll(/https?:\/\/([^/\s"]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(backends)], ['127.0.0.1:4010']);
  const names = [...directives.matchAll(/^\s*ServerName (\S+)$/gm)].map((match) => match[1]);
  assert.deepEqual(names, ['demo.example.test']);
  assert.doesNotMatch(directives, /0\.0\.0\.0|\[::\]/);
});

test('the vhost requires TLS and states the demo-only limit', () => {
  assert.match(vhost, /^\s*SSLEngine on$/m);
  assert.match(vhost, /^\s*SSLProtocol -all \+TLSv1\.2 \+TLSv1\.3$/m);
  assert.match(vhost, /Demo only\. Do not install this on a production server\./);
});

test('the vhost holds no certificate or key content', () => {
  assert.doesNotMatch(vhost, /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/);
});
