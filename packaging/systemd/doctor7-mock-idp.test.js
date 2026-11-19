'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const unit = fs.readFileSync(path.join(__dirname, 'doctor7-mock-idp.service'), 'utf8');

function section(name) {
  const match = new RegExp(`^\\[${name}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(unit);
  return match ? match[1] : '';
}

test('the unit runs as an unprivileged user, never as root', () => {
  assert.match(section('Service'), /^User=doctor7-idp$/m);
  assert.match(section('Service'), /^Group=doctor7-idp$/m);
  assert.doesNotMatch(unit, /^User=root$/m);
  assert.doesNotMatch(unit, /^Group=root$/m);
});

test('the unit sets NoNewPrivileges and ProtectSystem=strict', () => {
  assert.match(section('Service'), /^NoNewPrivileges=true$/m);
  assert.match(section('Service'), /^ProtectSystem=strict$/m);
});

test('the unit clears all capabilities', () => {
  assert.match(section('Service'), /^CapabilityBoundingSet=$/m);
  assert.match(section('Service'), /^AmbientCapabilities=$/m);
});

test('the unit runs the provider from the environment file, with no host name in it', () => {
  assert.match(section('Service'), /^EnvironmentFile=\/etc\/doctor7\/idp-demo\.env$/m);
  assert.match(section('Service'), /^ExecStart=\/usr\/bin\/node \/usr\/lib\/doctor7\/mock-idp\/server\.js$/m);
  assert.match(section('Service'), /^Environment=MOCK_IDP_PORT=4010$/m);
  assert.doesNotMatch(unit, /https?:\/\//);
});

test('the unit is for the demo only and is not enabled by default', () => {
  assert.match(unit, /demo only/i);
  assert.match(unit, /must not|do not run/i);
  assert.match(unit, /disabled by[\s#]+default/i);
  // The only install target is the one that systemctl enable needs. No Alias or Also.
  assert.match(section('Install'), /^WantedBy=multi-user\.target$/m);
  assert.doesNotMatch(section('Install'), /^(Also|Alias)=/m);
});

test('the unit writes no state and reads no home directory', () => {
  assert.match(section('Service'), /^ProtectHome=true$/m);
  assert.match(section('Service'), /^PrivateTmp=true$/m);
});
