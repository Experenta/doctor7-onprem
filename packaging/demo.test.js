'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseControl } = require('./build-deb');

const DEMO = path.join(__dirname, 'demo');
const PACKAGING = __dirname;
const read = (...parts) => fs.readFileSync(path.join(DEMO, ...parts), 'utf8');

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
const bashSkip = hasBash ? false : 'bash is not available on this machine';
const SYSTEM_NODE = fs.existsSync('/opt/node/current/bin/node');

// Lines that run a command. Comments and echo messages are left out.
function commands(text) {
  return text.split('\n').filter((line) => !/^\s*(#|echo\b)/.test(line)).join('\n');
}

test('the control file names the demo package, its dependencies, and its limit', () => {
  const fields = parseControl(read('DEBIAN', 'control'));
  assert.equal(fields.Package, 'doctor7-demo');
  assert.equal(fields.Version, '@VERSION@');
  assert.equal(fields.Architecture, 'all');
  assert.equal(fields.Depends, 'doctor7-api, adduser, systemd');
  assert.doesNotMatch(fields.Depends, /\bnodejs\b|\bnpm\b/);
  assert.match(fields.Description, /demo only/i);
  assert.match(fields.Description, /never production/i);
});

test('the maintainer scripts are POSIX sh, stop on error, and reject unknown arguments', () => {
  for (const name of ['postinst', 'prerm', 'postrm']) {
    const text = read('DEBIAN', name);
    assert.match(text, /^#!\/bin\/sh\n/, `${name} shebang`);
    assert.match(text, /^set -e$/m, `${name} set -e`);
    assert.match(text, /exit 0\n$/, `${name} ends with exit 0`);
    assert.match(text, /unknown argument/, `${name} rejects unknown arguments`);
    assert.doesNotMatch(text, /\[\[|\bsource\b/, `${name} uses a bashism`);
  }
});

test('postinst creates the user only when it is missing', () => {
  const postinst = read('DEBIAN', 'postinst');
  assert.match(postinst, /getent passwd "\$IDP_USER" >\/dev\/null/);
  assert.match(postinst, /adduser --system --group --home \/nonexistent --no-create-home "\$IDP_USER"/);
});

test('postinst installs the settings file only when it is missing, with mode 0640', () => {
  const postinst = read('DEBIAN', 'postinst');
  assert.match(
    postinst,
    /if \[ ! -e "\$ENV_FILE" \]; then\n\s*install -m 0640 -o root -g "\$IDP_USER" "\$SHARE_DIR\/idp-demo\.env\.example" "\$ENV_FILE"\n\s*fi/,
  );
  assert.equal((postinst.match(/"\$ENV_FILE"/g) || []).length, 2, 'the settings file is only written in that block');
});

test('postinst never enables or starts the unit', () => {
  const run = commands(read('DEBIAN', 'postinst'));
  assert.doesNotMatch(run, /systemctl\s+(enable|reenable|start|restart)\b/);
  // An upgrade restarts the unit only when it already runs.
  assert.match(run, /systemctl try-restart "\$UNIT"/);
});

test('prerm stops the unit on remove, disables it only on remove, and never starts it', () => {
  const run = commands(read('DEBIAN', 'prerm'));
  assert.match(run, /systemctl stop "\$UNIT"/);
  assert.match(run, /systemctl disable "\$UNIT"/);
  assert.doesNotMatch(run, /systemctl\s+(enable|start|restart)\b/);
  assert.match(run, /if \[ "\$1" = "remove" \]/);
});

test('postrm purge removes only the settings file this package wrote', () => {
  const postrm = read('DEBIAN', 'postrm');
  const purge = postrm.slice(postrm.indexOf('purge)'), postrm.indexOf(';;', postrm.indexOf('purge)')));
  assert.match(purge, /rm -f "\$ENV_FILE"/);
  assert.match(purge, /rmdir "\$ENV_DIR" 2>\/dev\/null/);
  assert.equal((postrm.match(/\brm\b/g) || []).length, 1, 'the only rm is the settings file');
  assert.doesNotMatch(postrm, /rm -r|deluser|delgroup|userdel|api\.env|backup\.conf|\/var\/lib/);
});

test('the settings template holds the three names and no value', () => {
  const text = read('usr', 'share', 'doctor7', 'idp-demo.env.example');
  const active = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  assert.deepEqual(active, ['MOCK_IDP_PUBLIC_URL=', 'MOCK_IDP_REDIRECT_URIS=', 'MOCK_IDP_CLIENT_ID=']);
  // Any URL in the comments uses the placeholder host, never a real one.
  for (const [, host] of text.matchAll(/https?:\/\/([^\s/]+)/g)) {
    assert.equal(host, '<host>', `unexpected host in the template: ${host}`);
  }
  assert.match(text, /Demo only\. Do not install this on a production server\./);
});

test('the unit runs start-idp.sh, which uses the Node lookup of doctor7-api', () => {
  const script = read('usr', 'lib', 'doctor7', 'start-idp.sh');
  assert.match(script, /^#!\/bin\/bash$/m);
  assert.match(script, /\. "\$LIB_DIR\/resolve-node\.sh"/);
  assert.match(script, /NODE=\$\(d7_resolve_node\) \|\| \{/);
  assert.match(script, /install Node\.js 22 or later/);
  assert.match(script, /cd "\$LIB_DIR\/mock-idp"/);
  assert.match(script, /exec "\$NODE" server\.js$/m);
  assert.ok(!script.includes('\r'), 'no carriage returns');
});

// A fixture with a fake node. The fake answers `-p` with the major version and
// prints its arguments and working directory when it runs the provider.
function fixture(t, major) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor7-idp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'doctor7');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(path.join(lib, 'mock-idp'), { recursive: true });
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(DEMO, 'usr', 'lib', 'doctor7', 'start-idp.sh'), path.join(lib, 'start-idp.sh'));
  fs.copyFileSync(path.join(PACKAGING, 'api', 'usr', 'lib', 'doctor7', 'resolve-node.sh'), path.join(lib, 'resolve-node.sh'));
  fs.writeFileSync(path.join(lib, 'mock-idp', 'server.js'), '');
  const fake = path.join(bin, 'node');
  fs.writeFileSync(
    fake,
    `#!/bin/sh\nif [ "$1" = "-p" ]; then echo ${major}; exit 0; fi\necho "fake-node $*"\npwd\n`,
    { mode: 0o755 },
  );
  return { lib, bin, fake };
}

function runStart(lib, env) {
  const script = path.join(lib, 'start-idp.sh').replace(/\\/g, '/');
  return spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('start-idp.sh refuses Node.js 20 with a clear message and runs nothing', { skip: bashSkip || SYSTEM_NODE && 'a Node exists at /opt/node/current' }, (t) => {
  const { lib, bin, fake } = fixture(t, 20);
  const result = runStart(lib, {
    NODE_BIN: fake.replace(/\\/g, '/'),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no usable Node\.js 22 or later was found/);
  assert.match(result.stderr, /install Node\.js 22 or later/);
});

test('start-idp.sh starts the provider with the first usable Node.js 22', { skip: bashSkip || SYSTEM_NODE && 'a Node exists at /opt/node/current' }, (t) => {
  const { lib, fake } = fixture(t, 22);
  const result = runStart(lib, { NODE_BIN: fake.replace(/\\/g, '/') });
  assert.equal(result.status, 0, result.stderr);
  const [line, cwd] = result.stdout.trim().split('\n');
  assert.equal(line, 'fake-node server.js');
  assert.match(cwd.replace(/\\/g, '/'), /\/mock-idp$/);
});


// ---- The /idp fragment (K-21) -----------------------------------------------

const FRAGMENT = path.join(DEMO, 'etc', 'doctor7', 'vhost-demo.conf');
const EXAMPLE = path.join(PACKAGING, 'apache', 'idp-demo.conf.example');
const WEB_VHOST = path.join(PACKAGING, 'web', 'etc', 'apache2', 'sites-available', 'doctor7.conf');

// The lines of a file that are directives: not empty, and not comments.
const directives = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

test('the demo package ships the /idp fragment with the proxy rules and nothing of the site', () => {
  const text = fs.readFileSync(FRAGMENT, 'utf8');
  const lines = directives(text);
  assert.ok(lines.includes('ProxyPass /idp/ http://127.0.0.1:4010/'), 'ProxyPass of /idp/');
  assert.ok(lines.includes('ProxyPassReverse /idp/ http://127.0.0.1:4010/'), 'ProxyPassReverse of /idp/');
  assert.ok(lines.includes('<Location "/idp/">'), 'the /idp/ Location block');
  assert.doesNotMatch(text, /<Location "\/">/);
  assert.doesNotMatch(text, /VirtualHost|ServerName|SSLEngine|SSLCertificate|Require all denied/);
  assert.doesNotMatch(text, /\r/, 'LF line endings');
});

test('every directive of the fragment is a line of the example, so the two cannot drift apart', () => {
  const example = fs.readFileSync(EXAMPLE, 'utf8').split('\n').map((line) => line.trim());
  for (const line of directives(fs.readFileSync(FRAGMENT, 'utf8'))) {
    assert.ok(example.includes(line), `"${line}" is not in idp-demo.conf.example`);
  }
});

test('the web virtual host includes the fragment with IncludeOptional, as the last directive of the TLS host', () => {
  const vhost = fs.readFileSync(WEB_VHOST, 'utf8');
  const tls = /<VirtualHost \*:443>([\s\S]*?)<\/VirtualHost>/.exec(vhost);
  assert.ok(tls, 'the TLS host exists');
  const body = directives(tls[1]);
  assert.equal(body[body.length - 1], 'IncludeOptional /etc/doctor7/vhost-demo.conf');

  const all = directives(vhost);
  assert.equal(all.filter((line) => line.includes('vhost-demo.conf')).length, 1, 'the fragment is included once');
  assert.ok(!all.some((line) => /^Include\s/.test(line) && line.includes('vhost-demo')), 'the include is not mandatory');
});
