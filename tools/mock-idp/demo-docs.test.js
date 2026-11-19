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
  // Hosts may be placeholders, example.test names, loopback, or the Jitsi vendor
  // repository (download.jitsi.org), which is not a deployment host.
  const allowed = (host) =>
    /^<[a-z-]+>$/.test(host) ||
    ['127.0.0.1', 'localhost', 'download.jitsi.org'].includes(host) ||
    /(^|\.)example\.test$/.test(host);
  const urls = [...demo.matchAll(/https?:\/\/([^\s/`)'"]+)/g)].map((match) => match[1].replace(/:\d+$/, ''));
  for (const host of urls) {
    assert.ok(allowed(host), `unexpected host in DEMO.md: ${host}`);
  }
  for (const [, domain] of demo.matchAll(/[\w.+-]+@([\w.-]+)/g)) {
    assert.ok(domain === 'example.test' || domain.endsWith('.example.test'), `unexpected domain: ${domain}`);
  }
});

test('DEMO.md contains no public IP address', () => {
  // Only the loopback address may appear as a literal address.
  const ipv4 = demo.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
  assert.deepEqual(
    ipv4.filter((ip) => ip !== '127.0.0.1'),
    [],
    'DEMO.md must use <local-ip> and <public-ip>, not addresses'
  );
  assert.doesNotMatch(demo, /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{1,4}\b/i, 'no IPv6 literal');
});

test('DEMO.md states that the data is synthetic and says how a reset is done', () => {
  assert.match(demo, /synthetic/i);
  assert.match(demo, /A reset is\s+manual/);
  assert.match(demo, /load a new seed/);
});

test('DEMO.md documents the /idp/ block of the example and why /idp is excluded from routing', () => {
  assert.match(demo, /### The \/idp\/ block/);
  assert.ok(demo.includes('ProxyPass /idp/ http://127.0.0.1:4010/'));
  assert.ok(demo.includes('ProxyPassReverse /idp/ http://127.0.0.1:4010/'));
  assert.match(demo, /excludes `\/idp` from its client\s+routing rule/);
});

test('DEMO.md has the Node 3 section with markers, the ports, and the NAT mapping', () => {
  const start = demo.indexOf('## Node 3: self-hosted Jitsi on Debian 13');
  assert.ok(start > 0, 'the Node 3 heading');
  const node3 = demo.slice(start);
  for (const marker of ['<host>', '<jitsi-host>', '<local-ip>', '<public-ip>']) {
    assert.ok(node3.includes(marker), `marker ${marker}`);
  }
  assert.ok(node3.includes('ice4j.harvest.mapping.static-mappings'), 'the NAT key');
  assert.ok(node3.includes('/etc/jitsi/videobridge/jvb.conf'), 'the NAT file');
  assert.ok(node3.includes('{ local-address = "<local-ip>", public-address = "<public-ip>", name = "demo-public-ip" }'));
  assert.ok(node3.includes('https://download.jitsi.org stable/'), 'the official repository');
  assert.ok(node3.includes('jitsi-meet'), 'the package');
  for (const port of ['80 | TCP', '443 | TCP', '10000 | UDP', '4443 | TCP | Not opened']) {
    assert.ok(node3.includes(port), port);
  }
  assert.match(node3, /Do not use `sip-communicator\.properties` with `NAT_HARVESTER_\*` for this mapping\./);
});

test('DEMO.md states that the real audio and video call was not verified', () => {
  const node3 = demo.slice(demo.indexOf('## Node 3: self-hosted Jitsi on Debian 13'));
  assert.match(node3, /Verified on the Debian 13 virtual machine/);
  assert.match(node3, /Not verified: a real audio and video call between two participants/);
});

test('OPERATIONS.md names the /idp block and the Jitsi origin rule', () => {
  const ops = fs.readFileSync(path.join(ROOT, 'docs', 'OPERATIONS.md'), 'utf8');
  assert.ok(ops.includes('idp-demo.conf.example'), 'the /idp example is named');
  assert.match(ops, /`\/idp\/` lines of `idp-demo\.conf\.example`/);
  assert.match(ops, /`\/api`, `\/ws` and `\/idp` are excluded/);
  assert.doesNotMatch(ops, /use the site origin/);
  assert.doesNotMatch(ops, /jitsi\.clinic\.example/);
});
