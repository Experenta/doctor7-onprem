'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Every action the chat module writes, found in its source, plus the video
// actions K-06 writes (the meeting action name is built from the provider).
function actionsInChatSource() {
  const dir = __dirname;
  const sources = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
  return [...new Set([...sources.matchAll(/action: '([a-z_.]+)'/g)].map((match) => match[1]))];
}

const VIDEO_ACTIONS = ['meeting.create', 'meeting.create_meet', 'meeting.create_jitsi', 'meeting.failover'];
const VIDEO_REASONS = ['not_configured', 'meet_error', 'meet_timeout', 'meet_quota'];
const CHAT_REASONS = ['appointment_closed', 'not_participant', 'not_found', 'role_not_allowed', 'other_center'];

test('docs/AUDIT.md lists every chat action the chat module writes', () => {
  const audit = read('docs/AUDIT.md');
  const actions = actionsInChatSource();
  assert.ok(actions.includes('chat.connect'), 'the chat source writes chat.connect');
  for (const action of actions) {
    assert.ok(audit.includes(`\`${action}\``), `${action} is documented`);
  }
});

test('docs/AUDIT.md lists the video actions that K-06 writes', () => {
  const audit = read('docs/AUDIT.md');
  for (const action of VIDEO_ACTIONS) {
    assert.ok(audit.includes(`\`${action}\``), `${action} is documented`);
  }
  for (const reason of VIDEO_REASONS) {
    assert.ok(audit.includes(`\`${reason}\``), `${reason} is documented`);
  }
});

test('docs/AUDIT.md documents the reason codes of the chat', () => {
  const audit = read('docs/AUDIT.md');
  for (const reason of CHAT_REASONS) {
    assert.ok(audit.includes(`\`${reason}\``), `${reason} is documented`);
  }
});

test('docs/AUDIT.md describes the chat purge as a chat target with no id', () => {
  const audit = read('docs/AUDIT.md');
  assert.match(audit, /`chat\.purge`\s*\|\s*`success`\s*\|\s*`chat`, no id/);
  assert.match(audit, /`audit`, or `chat`/);
});

test('docs/API.md documents /ws, its refusals, its close codes, and the frame types', () => {
  const api = read('docs/API.md');
  assert.ok(api.includes('### GET /ws'), 'the endpoint has a section');
  assert.ok(api.includes('`/ws?appointment=<id>`'), 'the endpoint table lists the path');
  for (const code of ['4001', '4002', '4003', '1009', '1001']) {
    assert.ok(api.includes(`| ${code} |`), `close code ${code} is documented`);
  }
  for (const code of ['invalid_request', 'unauthenticated', 'forbidden', 'not_found', 'appointment_closed']) {
    assert.ok(api.includes(`\`${code}\``), `${code} is documented`);
  }
  for (const type of ['"type":"history"', '"type":"message"', '"type":"error"']) {
    assert.ok(api.includes(type), `frame ${type} is documented`);
  }
});

test('the root npm test command runs the simulator tests as well', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /"tools\/\*\*\/\*\.test\.js"/);
  assert.match(read('README.md'), /"tools\/\*\*\/\*\.test\.js"/);
  assert.match(read('CLAUDE.md'), /"tools\/\*\*\/\*\.test\.js"/);
});

test('readDenialReason is defined once, in the care router, and the video router imports it', () => {
  const careRouter = read('api/src/care/router.js');
  const videoRouter = read('api/src/video/router.js');
  assert.equal((careRouter.match(/function readDenialReason\(/g) || []).length, 1);
  assert.equal((videoRouter.match(/function readDenialReason\(/g) || []).length, 0);
  assert.ok(videoRouter.includes("require('../care/router')"));
  assert.match(careRouter, /module\.exports = \{ createCareRouter, readDenialReason \}/);
});
