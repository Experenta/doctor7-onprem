'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BuildError, build, checkInputs, parseArgs, parseControl } = require('./build-deb');

const ROOT = path.join(__dirname, '..');
const PKG = __dirname;
const read = (...parts) => fs.readFileSync(path.join(PKG, ...parts), 'utf8');

function walk(dir, skip = () => false) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (skip(full, entry)) return [];
    return entry.isDirectory() ? walk(full, skip) : [full];
  });
}

const skipBuildOutput = (full, entry) => entry.isDirectory() && full === path.join(PKG, 'build');
const packagingFiles = walk(PKG, skipBuildOutput);

function shellScripts() {
  return packagingFiles.filter((file) => /^#!\/bin\/(ba)?sh\b/.test(fs.readFileSync(file, 'utf8').split('\n')[0]));
}

// Scripts reach the shell through stdin, so a Windows path never has to be translated.
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
const bashSkip = hasBash ? false : 'bash is not available on this machine';

function bash(script, { env } = {}) {
  return spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('there are shell scripts to check', () => {
  const names = shellScripts().map((file) => path.basename(file));
  for (const expected of [
    'postinst', 'prerm', 'postrm', 'start-api.sh', 'run-task.sh', 'resolve-node.sh',
    'doctor7-backup', 'doctor7-restore', 'install.sh', 'upgrade.sh', 'rollback.sh',
  ]) {
    assert.ok(names.includes(expected), `${expected} is missing from packaging/`);
  }
});

test('bash -n accepts every shell script', { skip: bashSkip }, () => {
  for (const file of shellScripts()) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('\r'), `${file} has carriage returns`);
    const result = spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.relative(ROOT, file)}: ${result.stderr}`);
  }
});

test('maintainer scripts are POSIX sh, stop on error and handle unknown arguments', () => {
  for (const pkg of ['api', 'web', 'demo']) {
    for (const name of ['postinst', 'prerm', 'postrm']) {
      const text = read(pkg, 'DEBIAN', name);
      assert.match(text, /^#!\/bin\/sh\n/, `${pkg}/${name} shebang`);
      assert.match(text, /^set -e$/m, `${pkg}/${name} set -e`);
      assert.match(text, /exit 0\n$/, `${pkg}/${name} ends with exit 0`);
      assert.doesNotMatch(text, /\[\[|\bsource\b|\blocal\b.*=\(/, `${pkg}/${name} uses a bashism`);
    }
  }
});

test('control files have the required fields', () => {
  for (const [pkg, name] of [['api', 'doctor7-api'], ['web', 'doctor7-web']]) {
    const fields = parseControl(read(pkg, 'DEBIAN', 'control'));
    for (const field of ['Package', 'Version', 'Architecture', 'Maintainer', 'Description', 'Depends']) {
      assert.ok(fields[field], `${name} has no ${field}`);
    }
    assert.equal(fields.Package, name);
    assert.equal(fields.Architecture, 'all');
    assert.equal(fields.Version, '@VERSION@');
  }
});

test('doctor7-api does not depend on the Debian nodejs package', () => {
  const fields = parseControl(read('api', 'DEBIAN', 'control'));
  for (const field of ['Depends', 'Pre-Depends', 'Recommends']) {
    assert.doesNotMatch(fields[field] || '', /\bnodejs\b|\bnpm\b/, field);
  }
  assert.match(fields.Depends, /\badduser\b/);
});

test('api maintainer scripts run no npm', () => {
  for (const name of ['postinst', 'prerm', 'postrm']) {
    assert.doesNotMatch(read('api', 'DEBIAN', name), /\bnpm\b|\bnpx\b/);
  }
});

const UNIT_DIR = ['api', 'usr', 'lib', 'systemd', 'system'];

test('the API unit runs unprivileged and hardened', () => {
  const unit = read(...UNIT_DIR, 'doctor7-api.service');
  assert.match(unit, /^User=doctor7$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/doctor7\/api\.env$/m);
  assert.match(unit, /^ExecStart=\/usr\/lib\/doctor7\/start-api\.sh$/m);
  assert.match(unit, /^StateDirectory=doctor7$/m);
  assert.doesNotMatch(unit, /^User=root$/m);
});

test('the purge unit is hardened and the timer runs daily', () => {
  const unit = read(...UNIT_DIR, 'doctor7-chat-purge.service');
  assert.match(unit, /^Type=oneshot$/m);
  assert.match(unit, /^User=doctor7$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^ExecStart=\/usr\/lib\/doctor7\/run-task\.sh purge$/m);
  const timer = read(...UNIT_DIR, 'doctor7-chat-purge.timer');
  assert.match(timer, /^OnCalendar=\*-\*-\* 03:15:00$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test('postinst creates api.env with mode 0600 and never overwrites it', () => {
  const postinst = read('api', 'DEBIAN', 'postinst');
  assert.match(postinst, /if \[ ! -e "\$ENV_FILE" \]/);
  assert.match(postinst, /install -m 0600 -o root -g root .*"\$ENV_FILE"/);
  assert.match(postinst, /chmod 0600 .*"\$ENV_FILE"/);
  assert.match(postinst, /adduser --system/);
});

test('the env template holds names only', () => {
  const lines = read('api', 'usr', 'share', 'doctor7', 'api.env.example').split('\n');
  const active = lines.filter((line) => line.trim() !== '' && !line.startsWith('#'));
  for (const line of active) {
    assert.match(line, /^[A-Z][A-Z0-9_]*=/, line);
  }
  const withValue = active.filter((line) => !/=$/.test(line));
  assert.deepEqual(withValue, ['TRUST_PROXY=1']);
  const text = lines.join('\n');
  for (const name of [
    'NODE_BIN', 'DATABASE_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI',
    'VIDEO_PROVIDER', 'JITSI_BASE_URL', 'CHAT_RETENTION_DAYS', 'TRUST_PROXY',
  ]) {
    assert.match(text, new RegExp(`^#?${name}=`, 'm'), name);
  }
});

test('start-api.sh tries NODE_BIN, then /opt/node/current/bin/node, then PATH', () => {
  const lib = read('api', 'usr', 'lib', 'doctor7', 'resolve-node.sh');
  const iEnv = lib.indexOf('${NODE_BIN:-}');
  const iOpt = lib.indexOf('"$D7_NODE_OPT_PATH" "$from_path"');
  assert.ok(iEnv > 0 && iOpt > iEnv, 'NODE_BIN is tried first, then the /opt path, then PATH');
  assert.match(lib, /D7_NODE_OPT_PATH=\/opt\/node\/current\/bin\/node/);
  assert.match(lib, /command -v node/);
  const start = read('api', 'usr', 'lib', 'doctor7', 'start-api.sh');
  assert.match(start, /resolve-node\.sh/);
  assert.match(start, /exec "\$NODE" src\/server\.js/);
});

test('node resolution fails with a clear message when no Node is usable', { skip: bashSkip }, (t) => {
  if (fs.existsSync('/opt/node/current/bin/node')) return t.skip('a Node exists at /opt/node/current');
  const lib = read('api', 'usr', 'lib', 'doctor7', 'resolve-node.sh');
  const result = bash(`PATH=/nonexistent\nNODE_BIN=/nonexistent/node\n${lib}\nd7_resolve_node\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_BIN is set but is not a usable Node\.js 22/);
  assert.match(result.stderr, /no usable Node\.js 22 or later was found/);
  assert.equal(result.stdout, '');
});

test('node resolution uses NODE_BIN first', { skip: bashSkip || process.platform === 'win32' }, () => {
  const lib = read('api', 'usr', 'lib', 'doctor7', 'resolve-node.sh');
  const major = Number(process.versions.node.split('.')[0]);
  const result = bash(`NODE_BIN='${process.execPath}'\n${lib}\nd7_resolve_node\n`);
  if (major >= 22) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), process.execPath);
  } else {
    assert.equal(result.status === 0 && result.stdout.trim() === process.execPath, false);
  }
});

const vhost = read('web', 'etc', 'apache2', 'sites-available', 'doctor7.conf');

test('the vhost rewrites only the sign-in cookie path, and keeps the session cookie at Path=/', () => {
  const lines = vhost.split('\n').map((line) => line.trim());
  assert.ok(lines.includes('ProxyPassReverseCookiePath /auth /api/auth'), 'missing /auth rule');
  const cookieRules = lines.filter((line) => line.startsWith('ProxyPassReverseCookiePath'));
  assert.deepEqual(cookieRules, ['ProxyPassReverseCookiePath /auth /api/auth']);
  assert.doesNotMatch(vhost, /^\s*ProxyPassReverseCookiePath \/ \/api\/\s*$/m);
});

test('the vhost comment explains why the session cookie keeps Path=/ for /ws', () => {
  const comment = vhost
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
    .join('\n');
  assert.match(comment, /session cookie keeps Path=\/ on purpose/);
  assert.match(comment, /\/ws has no prefix and must receive/);
});

test('the client routing rule excludes /api, /ws and /idp', () => {
  assert.ok(vhost.includes('RewriteCond %{REQUEST_URI} !^/(api|ws|idp)(/|$)'), 'the rewrite exclusion');
  assert.doesNotMatch(vhost, /RewriteCond %\{REQUEST_URI\} !\^\/\(api\|ws\)\(\/\|\$\)/);
});

test('the vhost proxies /api without its prefix and /ws with the websocket scheme', () => {
  assert.match(vhost, /^\s*ProxyPreserveHost On$/m);
  assert.match(vhost, /^\s*ProxyPass "\/api\/" "http:\/\/\$\{API_UPSTREAM\}\/"$/m);
  assert.match(vhost, /^\s*ProxyPassReverse "\/api\/" "http:\/\/\$\{API_UPSTREAM\}\/"$/m);
  assert.match(vhost, /^\s*ProxyPass "\/ws" "ws:\/\/\$\{API_UPSTREAM\}\/ws"/m);
  assert.match(vhost, /^\s*RequestHeader set X-Forwarded-Proto "https"$/m);
});

test('the vhost sets the content security policy for HTML', () => {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' wss://${SERVER_NAME}",
    "frame-src 'self' ${JITSI_ORIGIN}",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  assert.ok(vhost.includes(`Header always set Content-Security-Policy "${policy}"`));
  assert.doesNotMatch(vhost, /unsafe-inline|unsafe-eval/);
  const block = /<FilesMatch "\\\.html\$">([\s\S]*?)<\/FilesMatch>/.exec(vhost);
  assert.ok(block && block[1].includes('Content-Security-Policy'), 'the policy applies to HTML files');
});

test('the vhost sets the other security headers and TLS from variables', () => {
  assert.match(vhost, /Header always set Strict-Transport-Security "max-age=\d+; includeSubDomains"/);
  assert.match(vhost, /Header always set X-Content-Type-Options "nosniff"/);
  assert.match(vhost, /Header always set Referrer-Policy "[a-z-]+"/);
  assert.match(vhost, /^\s*Header always set Cross-Origin-Opener-Policy "same-origin"$/m);
  const permissions = /Header always set Permissions-Policy "(.*)"/.exec(vhost);
  assert.ok(permissions, 'Permissions-Policy is set');
  assert.match(permissions[1], /camera=\(self \\"\$\{JITSI_ORIGIN\}\\"\)/);
  assert.match(permissions[1], /microphone=\(self \\"\$\{JITSI_ORIGIN\}\\"\)/);
  assert.match(vhost, /^\s*SSLCertificateFile \$\{TLS_CERT_FILE\}$/m);
  assert.match(vhost, /^\s*SSLCertificateKeyFile \$\{TLS_KEY_FILE\}$/m);
  assert.match(vhost, /^\s*SSLProtocol -all \+TLSv1\.2 \+TLSv1\.3$/m);
});

test('the frame-src policy uses the Jitsi origin variable', () => {
  assert.match(vhost, /frame-src 'self' \$\{JITSI_ORIGIN\}/);
  assert.doesNotMatch(vhost, /frame-src[^;"]*jitsi\.example|frame-src[^;"]*clinic\.example/);
});

test('the example JITSI_ORIGIN is a different host from SERVER_NAME, and both are example.test names', () => {
  const vars = read('web', 'usr', 'share', 'doctor7', 'web.vars.conf.example');
  const value = (name) => {
    const match = new RegExp(`^Define ${name} (\\S+)$`, 'm').exec(vars);
    assert.ok(match, `${name} is defined`);
    return match[1];
  };
  const jitsiHost = new URL(value('JITSI_ORIGIN')).hostname;
  assert.notEqual(jitsiHost, value('SERVER_NAME'));
  assert.equal(jitsiHost, 'meet.demo.example.test');
  assert.equal(value('SERVER_NAME'), 'demo.example.test');
  assert.match(vars, /JITSI_ORIGIN is the origin of the Jitsi server, not the origin of the site/);
});

test('every variable of the vhost is defined in the variables example', () => {
  const vars = read('web', 'usr', 'share', 'doctor7', 'web.vars.conf.example');
  const defined = [...vars.matchAll(/^Define (\w+) /gm)].map((match) => match[1]);
  const used = new Set([...vhost.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]));
  used.delete('APACHE_LOG_DIR');
  for (const name of used) assert.ok(defined.includes(name), `${name} is not defined`);
  assert.ok(used.has('SERVER_NAME') && used.has('JITSI_ORIGIN'));
});

test('the web conffiles list the vhost', () => {
  assert.match(read('web', 'DEBIAN', 'conffiles'), /^\/etc\/apache2\/sites-available\/doctor7\.conf$/m);
});

test('the web postinst enables the required Apache modules', () => {
  const postinst = read('web', 'DEBIAN', 'postinst');
  for (const mod of ['proxy', 'proxy_http', 'proxy_wstunnel', 'headers', 'rewrite', 'deflate', 'expires', 'ssl']) {
    assert.match(postinst, new RegExp(`MODULES="[^"]*\\b${mod}\\b`), mod);
  }
});

test('backup and restore work per layer and keep the password off the command line', () => {
  const backup = read('api', 'usr', 'sbin', 'doctor7-backup');
  const restore = read('api', 'usr', 'sbin', 'doctor7-restore');
  for (const layer of ['app', 'api', 'db', 'files', 'all']) {
    assert.match(backup, new RegExp(`^\\s*${layer}\\)`, 'm'), `backup ${layer}`);
  }
  for (const layer of ['app', 'api', 'db', 'files']) {
    assert.match(restore, new RegExp(`\\b${layer}\\b`), `restore ${layer}`);
  }
  assert.match(backup, /^umask 077$/m);
  assert.match(backup, /--defaults-extra-file/);
  assert.match(restore, /--defaults-extra-file/);
  assert.doesNotMatch(backup + restore, /--password|MYSQL_PWD| -p\S/);
  assert.match(restore, /sha256sum --check/);
  assert.match(restore, /unsafe path/);
});

test('upgrade backs up before it installs, and rollback asks first', () => {
  const upgrade = read('scripts', 'upgrade.sh');
  assert.ok(upgrade.indexOf('doctor7-backup all') < upgrade.indexOf('apt-get install'));
  assert.match(upgrade, /migrate up/);
  const rollback = read('scripts', 'rollback.sh');
  assert.match(rollback, /--allow-downgrades/);
  assert.match(rollback, /doctor7-restore --yes db/);
});

test('PORTS.md lists each flow with source, destination, port, protocol and purpose', () => {
  const ports = fs.readFileSync(path.join(ROOT, 'docs', 'PORTS.md'), 'utf8');
  assert.match(ports, /\| Source \| Destination \| Port \| Protocol \| Purpose \|/);
  assert.match(ports, /\b10000\b.*\bUDP\b|\bUDP\b.*\b10000\b/);
  assert.match(ports, /\b443\b.*\bTCP\b/);
  assert.match(ports, /\b3306\b/);
  assert.match(ports, /\b3000\b/);
});

test('packaging and docs do not mention container tooling', () => {
  const term = new RegExp(['dock', 'er'].join(''), 'i');
  const docs = walk(path.join(ROOT, 'docs'));
  for (const file of [...packagingFiles, ...docs]) {
    const data = fs.readFileSync(file);
    if (data.includes(0)) continue;
    assert.doesNotMatch(data.toString('utf8'), term, path.relative(ROOT, file));
  }
});

test('packaging holds no key, certificate or private key block', () => {
  for (const file of packagingFiles) {
    assert.doesNotMatch(file, /\.(pem|key|crt|cer|p12|pfx)$/i, file);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/, file);
  }
});

function makeTemp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor7-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeDist(dir) {
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>test</title>\n');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'export {};\n');
  return dist;
}

test('the builder assembles both package trees', (t) => {
  const dir = makeTemp(t);
  const logs = [];
  const results = build({
    root: ROOT,
    out: path.join(dir, 'out'),
    webDist: makeDist(dir),
    version: '1.2.3-1',
    installDeps: false,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(results.map((result) => result.name), ['doctor7-api', 'doctor7-web']);
  const [api, web] = results;

  const apiControl = parseControl(fs.readFileSync(path.join(api.tree, 'DEBIAN', 'control'), 'utf8'));
  assert.equal(apiControl.Version, '1.2.3-1');
  assert.match(apiControl['Installed-Size'], /^\d+$/);
  assert.ok(fs.existsSync(path.join(api.tree, 'usr', 'lib', 'doctor7', 'api', 'src', 'server.js')));
  assert.ok(fs.existsSync(path.join(api.tree, 'usr', 'lib', 'doctor7', 'api', 'migrations', '0001_initial_schema.sql')));
  assert.ok(fs.existsSync(path.join(api.tree, 'usr', 'lib', 'doctor7', 'start-api.sh')));
  const shipped = walk(path.join(api.tree, 'usr', 'lib', 'doctor7', 'api'));
  assert.deepEqual(shipped.filter((file) => file.endsWith('.test.js')), []);

  assert.ok(fs.existsSync(path.join(web.tree, 'usr', 'share', 'doctor7', 'web', 'index.html')));
  assert.ok(fs.existsSync(path.join(web.tree, 'usr', 'share', 'doctor7', 'web', 'assets', 'app.js')));
  assert.ok(fs.existsSync(path.join(web.tree, 'etc', 'apache2', 'sites-available', 'doctor7.conf')));

  if (process.platform !== 'win32') {
    const mode = (file) => fs.statSync(file).mode & 0o777;
    assert.equal(mode(path.join(api.tree, 'DEBIAN', 'postinst')), 0o755);
    assert.equal(mode(path.join(api.tree, 'DEBIAN', 'control')), 0o644);
    assert.equal(mode(path.join(api.tree, 'usr', 'lib', 'doctor7', 'start-api.sh')), 0o755);
    assert.equal(mode(path.join(api.tree, 'usr', 'sbin', 'doctor7-backup')), 0o755);
    assert.equal(mode(path.join(api.tree, 'usr', 'lib', 'systemd', 'system', 'doctor7-api.service')), 0o644);
  }
  for (const result of results) {
    if (result.deb === null) assert.ok(logs.some((line) => line.includes('dpkg-deb was not found')));
    else assert.ok(fs.existsSync(result.deb));
  }
});

test('the builder stops with a clear message when web/dist is missing', (t) => {
  const dir = makeTemp(t);
  assert.throws(
    () => build({ root: ROOT, out: path.join(dir, 'out'), webDist: path.join(dir, 'none'), packages: ['web'], version: '1.0.0-1', log: () => {} }),
    (err) => err instanceof BuildError && /index\.html/.test(err.message) && /npm run build --workspace=web/.test(err.message),
  );
});

test('the builder stops with a clear message when package sources are missing', (t) => {
  const dir = makeTemp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"0.0.1"}\n');
  assert.throws(
    () => build({ root: dir, out: path.join(dir, 'out'), webDist: makeDist(dir), installDeps: false, log: () => {} }),
    (err) => err instanceof BuildError && /Cannot build/.test(err.message) && /DEBIAN.control/.test(err.message) && /server\.js/.test(err.message),
  );
});

test('the builder rejects a version that Debian does not accept', (t) => {
  const dir = makeTemp(t);
  assert.throws(
    () => build({ root: ROOT, out: dir, webDist: makeDist(dir), version: 'v1', installDeps: false, log: () => {} }),
    /not a valid Debian version/,
  );
});

test('the builder reads its command line', () => {
  assert.deepEqual(parseArgs(['web', '--no-deps', '--out', 'x']), { packages: ['web'], installDeps: false, out: 'x' });
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
});


test('the builder reads the demo package name and keeps it out of "all"', () => {
  assert.deepEqual(parseArgs(['demo']), { packages: ['demo'], installDeps: true });
  assert.deepEqual(parseArgs(['all']).packages, ['api', 'web']);
  assert.deepEqual(parseArgs([]).packages, ['api', 'web']);
});

test('the builder names every missing demo input', (t) => {
  const dir = makeTemp(t);
  const problems = checkInputs({ root: dir, packages: ['demo'], webDist: path.join(dir, 'dist'), installDeps: false });
  assert.ok(problems.some((line) => /packaging.demo.DEBIAN.control/.test(line)), 'DEBIAN control');
  assert.ok(problems.some((line) => /tools.mock-idp.server\.js/.test(line)), 'server.js');
  assert.ok(problems.some((line) => /rate-limit\.js/.test(line)), 'rate-limit.js');
  assert.ok(problems.some((line) => /idp-demo\.conf\.example/.test(line)), 'vhost example');
});

test('the builder assembles the demo package tree with the provider and its templates', (t) => {
  const dir = makeTemp(t);
  const logs = [];
  const [demo] = build({
    root: ROOT,
    out: path.join(dir, 'out'),
    packages: ['demo'],
    version: '1.2.3-1',
    installDeps: false,
    log: (line) => logs.push(line),
  });
  assert.equal(demo.name, 'doctor7-demo');

  const control = parseControl(fs.readFileSync(path.join(demo.tree, 'DEBIAN', 'control'), 'utf8'));
  assert.equal(control.Version, '1.2.3-1');
  assert.equal(control.Depends, 'doctor7-api, adduser, systemd');
  assert.doesNotMatch(control.Depends, /\bnodejs\b/);
  assert.match(control['Installed-Size'], /^\d+$/);

  const tree = (...parts) => path.join(demo.tree, ...parts);
  for (const parts of [
    ['DEBIAN', 'postinst'],
    ['DEBIAN', 'prerm'],
    ['DEBIAN', 'postrm'],
    ['usr', 'lib', 'doctor7', 'start-idp.sh'],
    ['usr', 'lib', 'systemd', 'system', 'doctor7-mock-idp.service'],
    ['usr', 'share', 'doctor7', 'idp-demo.env.example'],
    ['usr', 'share', 'doctor7', 'idp-demo.conf.example'],
    ['usr', 'lib', 'doctor7', 'mock-idp', 'server.js'],
    ['usr', 'lib', 'doctor7', 'mock-idp', 'rate-limit.js'],
  ]) {
    assert.ok(fs.existsSync(tree(...parts)), parts.join('/'));
  }
  // The provider folder holds the two modules and nothing else: no tests, no packages.
  assert.deepEqual(fs.readdirSync(tree('usr', 'lib', 'doctor7', 'mock-idp')).sort(), ['rate-limit.js', 'server.js']);

  const lf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(lf(tree('usr', 'lib', 'doctor7', 'mock-idp', 'server.js')), lf(path.join(ROOT, 'tools', 'mock-idp', 'server.js')));
  assert.equal(lf(tree('usr', 'lib', 'doctor7', 'mock-idp', 'rate-limit.js')), lf(path.join(ROOT, 'tools', 'mock-idp', 'rate-limit.js')));
  assert.equal(lf(tree('usr', 'share', 'doctor7', 'idp-demo.conf.example')), lf(path.join(ROOT, 'packaging', 'apache', 'idp-demo.conf.example')));

  if (process.platform !== 'win32') {
    const mode = (...parts) => fs.statSync(tree(...parts)).mode & 0o777;
    assert.equal(mode('DEBIAN', 'postinst'), 0o755);
    assert.equal(mode('usr', 'lib', 'doctor7', 'start-idp.sh'), 0o755);
    assert.equal(mode('usr', 'lib', 'systemd', 'system', 'doctor7-mock-idp.service'), 0o644);
    assert.equal(mode('usr', 'share', 'doctor7', 'idp-demo.env.example'), 0o644);
  }
  if (demo.deb === null) assert.ok(logs.some((line) => line.includes('dpkg-deb was not found')));
  else assert.ok(fs.existsSync(demo.deb));
});


// The rule every installed path must follow, checked here on its own, not by the builder.
const PACKAGE_DIRS = ['DEBIAN/', 'usr/', 'etc/'];
const isTestName = (name) => name.endsWith('.test.js') || name.endsWith('.test.mjs');
const relativeFiles = (dir) =>
  walk(dir)
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => path.relative(dir, file).split(path.sep).join('/'));

test('the package source folders hold no test file and no file outside DEBIAN, usr and etc', () => {
  for (const pkg of ['api', 'web', 'demo']) {
    for (const rel of relativeFiles(path.join(PKG, pkg))) {
      if (rel === '.gitkeep') continue;
      assert.ok(!isTestName(rel), `packaging/${pkg}/${rel} is a test file: move it out of the package folder`);
      assert.ok(PACKAGE_DIRS.some((dir) => rel.startsWith(dir)), `packaging/${pkg}/${rel} is outside DEBIAN, usr and etc`);
    }
  }
});

test('the built api, web and demo trees hold only DEBIAN, usr and etc, and no test file', (t) => {
  const dir = makeTemp(t);
  const results = build({
    root: ROOT,
    out: path.join(dir, 'out'),
    packages: ['api', 'web', 'demo'],
    webDist: makeDist(dir),
    version: '1.2.3-1',
    installDeps: false,
    log: () => {},
  });
  assert.deepEqual(results.map((result) => result.name), ['doctor7-api', 'doctor7-web', 'doctor7-demo']);
  for (const { name, tree } of results) {
    const files = relativeFiles(tree);
    assert.ok(files.length > 0, `${name} has files`);
    for (const rel of files) {
      assert.ok(PACKAGE_DIRS.some((dir) => rel.startsWith(dir)), `${name}: ${rel} would be installed outside DEBIAN, usr and etc`);
      assert.ok(!isTestName(rel), `${name}: ${rel} is a test file`);
    }
  }
});

test('the builder refuses a file outside DEBIAN, usr and etc before it builds anything', (t) => {
  const dir = makeTemp(t);
  const repo = path.join(dir, 'repo');
  fs.cpSync(path.join(PKG, 'demo'), path.join(repo, 'packaging', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packaging', 'demo', 'stray.txt'), 'stray\n');
  fs.writeFileSync(path.join(repo, 'packaging', 'demo', 'x.test.js'), '');
  const out = path.join(dir, 'out');
  assert.throws(
    () => build({ root: repo, out, packages: ['demo'], version: '1.0.0-1', installDeps: false, log: () => {} }),
    (err) => err instanceof BuildError
      && /packaging\/demo\/stray\.txt is outside DEBIAN\/, usr\/ and etc\//.test(err.message)
      && !/x\.test\.js/.test(err.message),
  );
  assert.equal(fs.existsSync(out), false, 'nothing is written when the check fails');
});
