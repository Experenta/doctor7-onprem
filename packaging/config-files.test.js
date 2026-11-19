'use strict';

// Checks the configuration-file rule of the three packages. The files are read from
// the packaging sources. Nothing is installed.
//
// The rule: a local value (a file the administrator edits) is never a conffile. The
// postinst creates it from a template only when it is missing. Only the Apache
// virtual host of doctor7-web is a conffile.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGING = __dirname;
const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Each local value: the package that creates it, the variable its postinst uses, and its path.
const LOCAL_VALUES = [
  { pkg: 'web', variable: 'VARS_FILE', file: '/etc/doctor7/web.vars.conf' },
  { pkg: 'api', variable: 'ENV_FILE', file: '/etc/doctor7/api.env' },
  { pkg: 'api', variable: 'BACKUP_CONF', file: '/etc/doctor7/backup.conf' },
  { pkg: 'demo', variable: 'ENV_FILE', file: '/etc/doctor7/idp-demo.env' },
];

const PACKAGES = ['api', 'web', 'demo'];

// The paths listed in DEBIAN/conffiles. A package without the file has none.
function conffiles(pkg) {
  const file = path.join(PACKAGING, pkg, 'DEBIAN', 'conffiles');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

test('no local value is a conffile of any package', () => {
  for (const { file } of LOCAL_VALUES) {
    for (const pkg of PACKAGES) {
      assert.ok(!conffiles(pkg).includes(file), `${file} is listed in ${pkg}/DEBIAN/conffiles`);
    }
  }
  for (const { file } of LOCAL_VALUES) {
    for (const pkg of PACKAGES) {
      const payload = path.join(PACKAGING, pkg, file.slice(1));
      assert.ok(!fs.existsSync(payload), `${file} is in the payload of ${pkg}; a local value must not ship`);
    }
  }
});

test('the conffiles are exactly the files that are package configuration', () => {
  assert.deepEqual(conffiles('web'), ['/etc/apache2/sites-available/doctor7.conf']);
  assert.deepEqual(conffiles('api'), []);
  assert.deepEqual(conffiles('demo'), []);
});

test('every conffile is a file of its own package tree', () => {
  for (const pkg of PACKAGES) {
    for (const file of conffiles(pkg)) {
      assert.ok(file.startsWith('/etc/'), `${pkg}: ${file} is outside /etc`);
      assert.ok(fs.statSync(path.join(PACKAGING, pkg, file.slice(1))).isFile(), `${pkg}: ${file} is not a file in the tree`);
    }
  }
});

test('each local value is assigned its path, and the postinst creates it only when it is missing', () => {
  for (const { pkg, variable, file } of LOCAL_VALUES) {
    const postinst = read(PACKAGING, pkg, 'DEBIAN', 'postinst');
    assert.match(postinst, new RegExp(`^${variable}=${escape(file)}$`, 'm'), `${pkg}: ${variable} is ${file}`);
    const guarded = new RegExp(
      `if \\[ ! -e "\\$${variable}" \\]; then\\n\\s*install [^\\n]*"\\$${variable}"\\n\\s*fi`,
    );
    assert.match(postinst, guarded, `${pkg}: ${file} is installed only inside "if [ ! -e ... ]"`);
  }
});

test('no maintainer script writes a local value except in the guarded install', () => {
  for (const { pkg, variable, file } of LOCAL_VALUES) {
    const writes = read(PACKAGING, pkg, 'DEBIAN', 'postinst')
      .split('\n')
      .filter((line) => line.includes(`"$${variable}"`))
      .filter((line) => /\b(install|cp|mv|tee|sed|cat|printf|echo)\b|>/.test(line));
    assert.equal(writes.length, 1, `${pkg}: ${file} has ${writes.length} write lines, expected one (the guarded install)`);
    assert.match(writes[0], /^\s*install /, `${pkg}: the write of ${file} is an install`);
  }
  for (const pkg of PACKAGES) {
    for (const name of ['prerm', 'postrm']) {
      const text = read(PACKAGING, pkg, 'DEBIAN', name);
      for (const { file } of LOCAL_VALUES.filter((value) => value.pkg === pkg)) {
        assert.doesNotMatch(
          text.replace(/^\s*#.*$/gm, ''),
          new RegExp(`(install|cp|tee|>)\\s[^\\n]*${escape(file)}`),
          `${pkg}/${name} writes ${file}`,
        );
      }
    }
  }
});

test('the web conffile is the vhost, and the postinst leaves the vhost alone', () => {
  const postinst = read(PACKAGING, 'web', 'DEBIAN', 'postinst');
  assert.doesNotMatch(postinst, /doctor7\.conf"?\s*$/m, 'the postinst does not install the vhost');
  assert.doesNotMatch(postinst, /install[^\n]*sites-available/);
});

test('OPERATIONS.md says which file is a conffile and which is a local value', () => {
  const doc = read(ROOT, 'docs', 'OPERATIONS.md');
  for (const { file } of LOCAL_VALUES) {
    assert.ok(doc.includes(file), `${file} is named in docs/OPERATIONS.md`);
  }
  assert.ok(doc.includes('/etc/apache2/sites-available/doctor7.conf'), 'the vhost is named');
  assert.match(doc, /conffile/);
  assert.match(doc, /local value/);
});

test('OPERATIONS.md explains --force-confold and --force-confnew', () => {
  const doc = read(ROOT, 'docs', 'OPERATIONS.md');
  assert.match(doc, /--force-confold/);
  assert.match(doc, /--force-confnew/);
  // Each option has its own sentence: one keeps the local file, the other takes the package file.
  assert.match(doc, /--force-confold[^\n]*keep[^\n]*local/i);
  assert.match(doc, /--force-confnew[^\n]*package/i);
});
