'use strict';

// Checks the static-file rules of the real doctor7 virtual host. The vhost is in
// packaging/web, which the Debian package installs. This test only reads it.
// It checks compression with mod_deflate, the long cache for hashed build files,
// and no-cache for HTML, and that the package enables the modules those rules need.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VHOST = path.join(ROOT, 'packaging', 'web', 'etc', 'apache2', 'sites-available', 'doctor7.conf');
const POSTINST = path.join(ROOT, 'packaging', 'web', 'DEBIAN', 'postinst');

// The vhost without its comment lines, so a commented-out rule cannot pass.
const vhost = fs
  .readFileSync(VHOST, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

// The body of a <Directory> or <FilesMatch> block with the given opening line.
function block(opening) {
  const escaped = opening.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const match = vhost.match(new RegExp(`<${escaped}>([\\s\\S]*?)</`));
  assert.ok(match, `missing block: ${opening}`);
  return match[1];
}

test('the vhost compresses HTML, CSS, JavaScript, JSON, and SVG with mod_deflate', () => {
  const filter = vhost.match(/^\s*AddOutputFilterByType DEFLATE (.+)$/m);
  assert.ok(filter, 'missing AddOutputFilterByType DEFLATE');
  const types = filter[1].trim().split(/\s+/);
  for (const type of ['text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml']) {
    assert.ok(types.includes(type), `${type} is not compressed`);
  }
});

test('HTML responses are sent with no-cache, so index.html is revalidated on each visit', () => {
  const html = block('FilesMatch "\\.html$"');
  assert.match(html, /^\s*Header always set Cache-Control "no-cache"$/m);
});

test('hashed build files under /assets are cached for a year and marked immutable', () => {
  const assets = block('Directory /usr/share/doctor7/web/assets');
  assert.match(assets, /^\s*ExpiresActive On$/m);
  assert.match(assets, /^\s*ExpiresDefault "access plus 1 year"$/m);
  assert.match(assets, /^\s*Header append Cache-Control "public, immutable"$/m);
});

test('the long cache is not set on HTML, and the no-cache rule is not set on assets', () => {
  const html = block('FilesMatch "\\.html$"');
  const assets = block('Directory /usr/share/doctor7/web/assets');
  assert.doesNotMatch(html, /immutable|ExpiresActive/);
  assert.doesNotMatch(assets, /no-cache/);
});

test('the package enables the Apache modules that these rules need', () => {
  const postinst = fs.readFileSync(POSTINST, 'utf8');
  const modules = postinst.match(/^MODULES="([^"]+)"$/m);
  assert.ok(modules, 'postinst does not list the modules');
  const enabled = modules[1].split(/\s+/);
  for (const name of ['deflate', 'expires', 'headers']) {
    assert.ok(enabled.includes(name), `${name} is not enabled by the package`);
  }
});
