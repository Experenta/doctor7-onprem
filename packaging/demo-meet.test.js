'use strict';

// Tests of the Google Meet simulator part of the demo package (K-36). The files are read from
// the packaging sources. Nothing is installed and no service runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build } = require('./build-deb');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(__dirname, 'demo');
const read = (...parts) => fs.readFileSync(path.join(DEMO, ...parts), 'utf8');
const UNIT_DIR = ['usr', 'lib', 'systemd', 'system'];

const unit = read(...UNIT_DIR, 'doctor7-mock-google.service');
const idpUnit = read(...UNIT_DIR, 'doctor7-mock-idp.service');
const postinst = read('DEBIAN', 'postinst');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

function section(text, name) {
  const match = new RegExp(`^\\[${name}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(text);
  return match ? match[1] : '';
}

// The lines that run a command. Comments and echo messages are left out.
const commands = (text) => text.split('\n').filter((line) => !/^\s*(#|echo\b)/.test(line)).join('\n');

// The hardening directives of the identity provider unit, name and value.
const HARDENING = [
  'NoNewPrivileges',
  'ProtectSystem',
  'ProtectHome',
  'PrivateTmp',
  'PrivateDevices',
  'ProtectKernelTunables',
  'ProtectKernelModules',
  'ProtectControlGroups',
  'RestrictSUIDSGID',
  'RestrictRealtime',
  'LockPersonality',
  'CapabilityBoundingSet',
  'AmbientCapabilities',
  'RestrictAddressFamilies',
  'SystemCallArchitectures',
];

test('the simulator unit exists, runs as its own unprivileged user, and is for the demo only', () => {
  assert.match(section(unit, 'Service'), /^User=doctor7-meet$/m);
  assert.match(section(unit, 'Service'), /^Group=doctor7-meet$/m);
  assert.doesNotMatch(unit, /^(User|Group)=root$/m);
  assert.match(unit, /demo only/i);
  assert.match(unit, /do not run it/i);
  assert.match(unit, /disabled by[\s#]+default/i);
});

test('the simulator unit is not enabled by default: its only install target is the one that enable needs', () => {
  assert.match(section(unit, 'Install'), /^WantedBy=multi-user\.target$/m);
  assert.doesNotMatch(section(unit, 'Install'), /^(Also|Alias|RequiredBy)=/m);
  assert.doesNotMatch(read('DEBIAN', 'postinst').replace(/^\s*(#|echo\b).*$/gm, ''), /systemctl\s+(enable|reenable|start|restart)\b/);
});

test('the simulator unit has the hardening of the identity provider unit, with the same values', () => {
  const value = (text, name) => new RegExp(`^${name}=(.*)$`, 'm').exec(section(text, 'Service'))?.[1];
  for (const name of HARDENING) {
    assert.notEqual(value(idpUnit, name), undefined, `${name} is in the identity provider unit`);
    assert.equal(value(unit, name), value(idpUnit, name), name);
  }
});

test('the simulator unit allows loopback only', () => {
  assert.match(section(unit, 'Service'), /^IPAddressDeny=any$/m);
  assert.match(section(unit, 'Service'), /^IPAddressAllow=localhost$/m);
  assert.match(section(unit, 'Service'), /^RestrictAddressFamilies=AF_INET AF_INET6$/m);
  // The address and the port are fixed in the simulator and in the unit, not in a setting.
  const simulator = fs.readFileSync(path.join(ROOT, 'tools', 'mock-google', 'server.js'), 'utf8');
  assert.match(simulator, /const HOST = '127\.0\.0\.1';/);
  assert.match(section(unit, 'Service'), /^Environment=MOCK_GOOGLE_PORT=4020$/m);
  assert.doesNotMatch(unit, /0\.0\.0\.0|https?:\/\//);
});

test('the simulator unit reads its settings file and starts through start-google.sh', () => {
  assert.match(section(unit, 'Service'), /^EnvironmentFile=\/etc\/doctor7\/mock-google\.env$/m);
  assert.match(section(unit, 'Service'), /^ExecStart=\/usr\/lib\/doctor7\/start-google\.sh$/m);
  assert.match(section(unit, 'Service'), /^WorkingDirectory=\/usr\/lib\/doctor7\/mock-google$/m);
  const script = read('usr', 'lib', 'doctor7', 'start-google.sh');
  assert.match(script, /^#!\/bin\/bash$/m);
  assert.match(script, /\. "\$LIB_DIR\/resolve-node\.sh"/);
  assert.match(script, /NODE=\$\(d7_resolve_node\) \|\| \{/);
  assert.match(script, /cd "\$LIB_DIR\/mock-google"/);
  assert.match(script, /exec "\$NODE" server\.js$/m);
  assert.ok(!script.includes('\r'), 'no carriage returns');
});

test('postinst creates the simulator user only when it is missing', () => {
  assert.match(postinst, /getent passwd "\$MEET_USER" >\/dev\/null/);
  assert.match(postinst, /adduser --system --group --home \/nonexistent --no-create-home "\$MEET_USER"/);
  assert.match(postinst, /^MEET_USER=doctor7-meet$/m);
});

test('postinst makes the key pair and the secret on the host, with openssl, and stores nothing in the package', () => {
  assert.match(postinst, /openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "\$work\/key\.pem"/);
  assert.match(postinst, /openssl pkey -in "\$work\/key\.pem" -pubout -out "\$work\/public\.pem"/);
  assert.match(postinst, /secret=\$\(openssl rand -hex 32\)/);
  // The private key is made in a temporary folder that only its owner can use, and the folder is removed.
  assert.match(postinst, /umask 077/);
  assert.match(postinst, /work=\$\(mktemp -d \/tmp\/doctor7-meet\.XXXXXX\)/);
  assert.match(postinst, /rm -rf "\$work"/);
  // No key material, secret, or token is written in the script. A long hex or base64 literal would be one.
  assert.doesNotMatch(postinst, /[0-9a-f]{32,}/i);
  assert.doesNotMatch(postinst, /[A-Za-z0-9+/]{40,}={0,2}/);
});

test('postinst writes the three simulator files with mode 0640, the group of the service that needs each, only when none exists', () => {
  assert.match(postinst, /^MEET_ENV_FILE=\/etc\/doctor7\/mock-google\.env$/m);
  assert.match(postinst, /^MEET_API_ENV_FILE=\/etc\/doctor7\/meet-demo-credentials\.env$/m);
  assert.match(postinst, /^MEET_PUBLIC_KEY=\/etc\/doctor7\/meet-demo-public-key\.pem$/m);
  assert.match(postinst, /install -m 0640 -o root -g "\$MEET_USER" \/dev\/null "\$MEET_ENV_FILE"/);
  assert.match(postinst, /install -m 0640 -o root -g "\$MEET_USER" \/dev\/null "\$MEET_PUBLIC_KEY"/);
  assert.match(postinst, /install -m 0640 -o root -g "\$API_GROUP" \/dev\/null "\$MEET_API_ENV_FILE"/);
  assert.match(postinst, /^API_GROUP=doctor7$/m);
  assert.match(
    postinst,
    /if \[ -e "\$MEET_ENV_FILE" \] \|\| \[ -e "\$MEET_API_ENV_FILE" \] \|\| \[ -e "\$MEET_PUBLIC_KEY" \]; then[\s\S]*?return 0\n  fi/,
  );
  // The simulator never gets the private key: its file holds the secret and the public key path only.
  const simulatorBlock = /install -m 0640 -o root -g "\$MEET_USER" \/dev\/null "\$MEET_ENV_FILE"\n([\s\S]*?)> "\$MEET_ENV_FILE"/.exec(postinst);
  assert.ok(simulatorBlock, 'the simulator settings block is found');
  assert.doesNotMatch(simulatorBlock[1], /key_line|GOOGLE_SERVICE_ACCOUNT_JSON|PRIVATE/);
  assert.match(simulatorBlock[1], /MOCK_GOOGLE_CONTROL_SECRET=%s/);
});

test('postinst gives the API the synthetic credential, the simulator addresses, and the demo switch', () => {
  for (const line of [
    "printf 'VIDEO_PROVIDER=meet\\n'",
    "printf 'DEMO_MODE=1\\n'",
    "printf 'GOOGLE_MEET_DELEGATED_USER=%s\\n' \"$MEET_DELEGATED_USER\"",
    "printf 'GOOGLE_MEET_API_BASE_URL=http://127.0.0.1:%s\\n' \"$MEET_PORT\"",
    "printf 'DEMO_MEET_CONTROL_URL=http://127.0.0.1:%s\\n' \"$MEET_PORT\"",
    "printf 'DEMO_MEET_CONTROL_SECRET=%s\\n' \"$secret\"",
  ]) {
    assert.ok(postinst.includes(line), line);
  }
  assert.match(postinst, /printf "GOOGLE_SERVICE_ACCOUNT_JSON='\{/);
  assert.match(postinst, /\\"token_uri\\":\\"http:\/\/127\.0\.0\.1:%s\/token\\"/);
  assert.match(postinst, /^MEET_SA_EMAIL=meet-sa@doctor7-test\.example\.test$/m);
  assert.match(postinst, /^MEET_DELEGATED_USER=clinic\.organizer@example\.test$/m);
  assert.match(postinst, /^MEET_PORT=4020$/m);
});

test('postinst restarts the simulator on an upgrade only when it runs, and never starts or enables it', () => {
  const run = commands(postinst);
  assert.match(run, /systemctl try-restart "\$MEET_UNIT"/);
  assert.doesNotMatch(run, /systemctl\s+(enable|reenable|start|restart)\b/);
});

test('prerm stops and disables the simulator unit on remove, and never starts it', () => {
  const run = commands(read('DEBIAN', 'prerm'));
  assert.match(run, /systemctl stop "\$MEET_UNIT"/);
  assert.match(run, /systemctl disable "\$MEET_UNIT"/);
  assert.doesNotMatch(run, /systemctl\s+(enable|start|restart)\b/);
});

test('postrm purge removes the generated simulator files and nothing else new', () => {
  const postrm = read('DEBIAN', 'postrm');
  assert.match(postrm, /^MEET_ENV_FILE=\/etc\/doctor7\/mock-google\.env$/m);
  assert.match(postrm, /^MEET_API_ENV_FILE=\/etc\/doctor7\/meet-demo-credentials\.env$/m);
  assert.match(postrm, /^MEET_PUBLIC_KEY=\/etc\/doctor7\/meet-demo-public-key\.pem$/m);
  assert.match(postrm, /rm -f "\$MEET_ENV_FILE" "\$MEET_API_ENV_FILE" "\$MEET_PUBLIC_KEY"/);
  assert.doesNotMatch(postrm, /rm -r|deluser|delgroup|userdel/);
});

test('the drop-in example only adds the generated settings file, and it is not wired by default', () => {
  const text = read('usr', 'share', 'doctor7', 'doctor7-api-demo-meet.conf.example');
  const active = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  assert.deepEqual(active, ['[Service]', 'EnvironmentFile=/etc/doctor7/meet-demo-credentials.env']);
  assert.match(text, /Demo only\. Do not install this on a production server\./);
  assert.match(text, /on purpose/);
  // The package ships no drop-in under /etc or /usr/lib/systemd, so nothing reads the file by itself.
  assert.ok(!fs.existsSync(path.join(DEMO, 'etc', 'systemd')));
  assert.ok(!fs.existsSync(path.join(DEMO, ...UNIT_DIR, 'doctor7-api.service.d')));
});

test('no private key or token is stored in the packaging, the simulator, or the demo API code', () => {
  const pem = new RegExp(`${'-----BEGIN '}[A-Z ]*${'PRIVATE KEY'}-----`);
  const folders = [__dirname, path.join(ROOT, 'tools', 'mock-google'), path.join(ROOT, 'api', 'src', 'demo')];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'build' && entry.name !== 'node_modules') visit(full);
      } else {
        files.push(full);
      }
    }
  };
  folders.forEach(visit);
  assert.ok(files.length > 20, 'the scan found the files');
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), pem, `${path.relative(ROOT, file)} holds a private key`);
  }
  assert.ok(!files.some((file) => /\.(pem|key|p12|pfx)$/i.test(file)), 'no key file');
});

test('the maintainer scripts and start-google.sh are valid shell', { skip: hasBash ? false : 'bash is not available on this machine' }, () => {
  for (const file of [['DEBIAN', 'postinst'], ['DEBIAN', 'prerm'], ['DEBIAN', 'postrm'], ['usr', 'lib', 'doctor7', 'start-google.sh']]) {
    const target = path.join(DEMO, ...file).replace(/\\/g, '/');
    const result = spawnSync('bash', ['-n', target], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file.join('/')}: ${result.stderr}`);
  }
});

test('the demo package tree holds the simulator, its unit, its start script, and the drop-in example', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor7-meet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [demo] = build({ root: ROOT, out: dir, packages: ['demo'], version: '1.2.3-1', installDeps: false, log: () => {} });
  const tree = (...parts) => path.join(demo.tree, ...parts);
  for (const parts of [
    [...UNIT_DIR, 'doctor7-mock-google.service'],
    ['usr', 'lib', 'doctor7', 'start-google.sh'],
    ['usr', 'lib', 'doctor7', 'mock-google', 'server.js'],
    ['usr', 'share', 'doctor7', 'doctor7-api-demo-meet.conf.example'],
  ]) {
    assert.ok(fs.existsSync(tree(...parts)), parts.join('/'));
  }
  // The simulator folder holds the one program: no test, no test aid, no key.
  assert.deepEqual(fs.readdirSync(tree('usr', 'lib', 'doctor7', 'mock-google')), ['server.js']);
  const lf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(lf(tree('usr', 'lib', 'doctor7', 'mock-google', 'server.js')), lf(path.join(ROOT, 'tools', 'mock-google', 'server.js')));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(tree('usr', 'lib', 'doctor7', 'start-google.sh')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(tree(...UNIT_DIR, 'doctor7-mock-google.service')).mode & 0o777, 0o644);
  }
  // Nothing in the built tree is a generated secret: the files exist on the host only.
  for (const name of ['mock-google.env', 'meet-demo-credentials.env', 'meet-demo-public-key.pem']) {
    assert.ok(!fs.existsSync(tree('etc', 'doctor7', name)), `${name} is not in the package`);
  }
});
