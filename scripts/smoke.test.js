'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { main } = require('./smoke');
const { startStack } = require('./lib/stack');
const { parseAccountForm, issuedSession } = require('./lib/login');
const { CookieJar, pathMatches } = require('./lib/cookies');
const { STEPS } = require('./lib/steps');
const { SmokeFailure } = require('./lib/http');

// Collects what main writes to its output and error streams.
function capture() {
  const sink = { out: '', err: '' };
  return {
    sink,
    io: {
      out: { write: (text) => { sink.out += text; } },
      err: { write: (text) => { sink.err += text; } },
    },
  };
}

// Output must never hold a cookie, a token, an e-mail address, or a URL.
const LEAK_PATTERN = /@|d7_session|d7_login|set-cookie|cookie|token|bearer|code=|state=|https?:\/\//i;
function assertNoLeak(text) {
  assert.equal(LEAK_PATTERN.test(text), false, `output must not hold secrets or addresses: ${text}`);
}

function linesMatching(text, pattern) {
  return text.split('\n').filter((line) => pattern.test(line));
}

test('in process, the full run passes all seven steps and prints no secret or address', async () => {
  const { sink, io } = capture();
  const code = await main([], {}, io);
  assert.equal(code, 0, sink.out);
  assert.equal(linesMatching(sink.out, /^OK   \d\/7 /).length, 7, sink.out);
  assert.match(sink.out, /Result: PASS \(7 of 7 steps run passed\)/);
  assert.match(
    sink.out,
    /OK   3\/7 video meeting: meeting created, provider (meet|jitsi); the client reads the same room; a repeated request returns it unchanged/
  );
  assert.match(sink.out, /smoke-/);
  assertNoLeak(sink.out);
  assertNoLeak(sink.err);
});

test('a video step that cannot create a meeting fails the run and names it, and the other steps still run', async () => {
  const { sink, io } = capture();
  const code = await main(['--no-video-provider'], {}, io);
  assert.equal(code, 1, sink.out);
  assert.match(sink.out, /FAIL 3\/7 video meeting: the meeting was not created \(HTTP 503, video_not_configured\)/);
  for (const number of [1, 2, 4, 5, 6, 7]) {
    assert.equal(linesMatching(sink.out, new RegExp(`^OK   ${number}/7 `)).length, 1, `step ${number} must pass`);
  }
  assert.match(sink.out, /Result: FAIL \(6 of 7 steps run passed\)/);
  assertNoLeak(sink.out);
});

test('when Meet fails, the meeting falls back to Jitsi and the run still passes', async () => {
  const { sink, io } = capture();
  const code = await main(['--google-mode=http_500'], {}, io);
  assert.equal(code, 0, sink.out);
  assert.match(sink.out, /OK   3\/7 video meeting: meeting created, provider jitsi/);
  assertNoLeak(sink.out);
});

test('read-only mode runs the read steps and skips the write steps, and still passes', async () => {
  const { sink, io } = capture();
  const code = await main([], { SMOKE_READ_ONLY: '1' }, io);
  assert.equal(code, 0, sink.out);
  assert.equal(linesMatching(sink.out, /^SKIP /).length, 4, sink.out);
  assert.match(sink.out, /Result: PASS \(3 of 3 steps run passed; 4 skipped in read-only mode\)/);
  assert.doesNotMatch(sink.out, /Records created by this run/);
  assertNoLeak(sink.out);
});

test('remote mode runs the same flow against a running instance', async () => {
  const stack = await startStack();
  try {
    const { sink, io } = capture();
    const code = await main(['--remote'], { SMOKE_BASE_URL: stack.origin, SMOKE_API_PREFIX: '' }, io);
    assert.equal(code, 0, sink.out);
    assert.match(sink.out, /Result: PASS \(7 of 7 steps run passed\)/);
    assertNoLeak(sink.out);
  } finally {
    await stack.close();
  }
});

test('remote mode without SMOKE_BASE_URL stops before any request and names the variable', async () => {
  const { sink, io } = capture();
  const code = await main(['--remote'], {}, io);
  assert.equal(code, 2);
  assert.match(sink.err, /SMOKE_BASE_URL is required with --remote/);
  assert.equal(sink.out, '');
});

test('SMOKE_BASE_URL without --remote stops, so a remote run cannot silently become an in-process run', async () => {
  const { sink, io } = capture();
  const code = await main([], { SMOKE_BASE_URL: 'https://demo.example.test' }, io);
  assert.equal(code, 2);
  assert.match(sink.err, /--remote/);
  assert.equal(sink.out, '');
  assert.equal(sink.err.includes('demo.example.test'), false, 'the value must not be printed');
});

test('remote mode refuses a site address with a path, a query, or plain http off loopback', async () => {
  for (const bad of ['https://demo.example.test/api', 'http://demo.example.test', 'not a url']) {
    const { sink, io } = capture();
    const code = await main(['--remote'], { SMOKE_BASE_URL: bad }, io);
    assert.equal(code, 2, `"${bad}" must be refused`);
    assert.equal(sink.err.includes(bad), false, 'the value must not be printed');
    assert.equal(sink.out, '');
  }
});

test('remote mode refuses an API prefix with a trailing slash', async () => {
  const { sink, io } = capture();
  const code = await main(['--remote'], { SMOKE_BASE_URL: 'https://demo.example.test', SMOKE_API_PREFIX: '/api/' }, io);
  assert.equal(code, 2);
  assert.match(sink.err, /SMOKE_API_PREFIX/);
});

test('an unreachable instance fails step 1 by name, blocks the rest, and exits 1', async () => {
  const { sink, io } = capture();
  const code = await main(['--remote'], { SMOKE_BASE_URL: 'http://127.0.0.1:1' }, io);
  assert.equal(code, 1, sink.out);
  assert.match(sink.out, /FAIL 1\/7 sign-in: no answer from the server \(network error\)/);
  // Steps 2 and 7 need step 1. Steps 3 to 6 need step 2, which is blocked too.
  assert.equal(linesMatching(sink.out, /^FAIL \d\/7 .*not run, step 1 failed/).length, 2);
  assert.equal(linesMatching(sink.out, /^FAIL \d\/7 .*not run, step \d failed/).length, 6);
  assertNoLeak(sink.out);
});

test('the read-only setting accepts only 0 or 1', async () => {
  const { sink, io } = capture();
  assert.equal(await main([], { SMOKE_READ_ONLY: 'yes' }, io), 2);
  assert.match(sink.err, /SMOKE_READ_ONLY must be 1/);
});

test('an unknown option and an unknown google mode are refused, and the option is not echoed', async () => {
  const unknown = capture();
  assert.equal(await main(['--token=abc123'], {}, unknown.io), 2);
  assert.equal(unknown.sink.err.includes('abc123'), false);

  const mode = capture();
  assert.equal(await main(['--google-mode=nope'], {}, mode.io), 2);
  assert.match(mode.sink.err, /--google-mode must be one of/);
});

test('the failure options are refused in remote mode', async () => {
  const { sink, io } = capture();
  const code = await main(['--remote', '--no-video-provider'], { SMOKE_BASE_URL: 'https://demo.example.test' }, io);
  assert.equal(code, 2);
  assert.match(sink.err, /work only in process mode/);
  assert.equal(sink.out, '');
});

test('the command line exits with the code of main for a configuration error', async () => {
  const script = path.join(__dirname, 'smoke.js');
  const env = { ...process.env, SMOKE_BASE_URL: '', SMOKE_READ_ONLY: '' };
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [script, '--remote'], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /SMOKE_BASE_URL is required with --remote/);
});

test('the command line runs the in-process smoke and exits 0', async () => {
  const script = path.join(__dirname, 'smoke.js');
  const env = { ...process.env, SMOKE_BASE_URL: '', SMOKE_READ_ONLY: '', SMOKE_API_PREFIX: '' };
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [script], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Result: PASS \(7 of 7 steps run passed\)/);
  assertNoLeak(result.stdout);
});

test('the sign-in page is read by e-mail: the account button, the action, and the hidden fields', () => {
  const html = `<!doctype html><form method="post" action="http://127.0.0.1:4010/authorize">
<input type="hidden" name="state" value="abc&#38;def">
<ul class="accounts">
<li class="account"><p class="account-name">Ana Rivera</p><p class="account-meta"><span class="role">Professional</span> <span>ana.rivera@example.test</span></p><button type="submit" name="user" value="mock-ana">Sign in</button></li>
<li class="account"><p class="account-name">Pending</p><p class="account-meta"><span>pending@example.test</span></p><button type="submit" name="user" value="mock-pending">Sign in</button></li>
</ul></form>`;
  const form = parseAccountForm(html, 'pending@example.test');
  assert.equal(form.user, 'mock-pending');
  assert.equal(form.action, 'http://127.0.0.1:4010/authorize');
  assert.deepEqual(form.fields, [['state', 'abc&def']]);
  assert.throws(() => parseAccountForm(html, 'nobody@example.test'), SmokeFailure);
});

test('the cookie jar sends a cookie only to its host and its path, and a removal clears it', () => {
  const jar = new CookieJar();
  jar.store('https://a.example.test/api/auth/login', ['d7_login=binding; Path=/api/auth; HttpOnly; Secure']);
  assert.equal(jar.headerFor('https://a.example.test/api/auth/callback'), 'd7_login=binding');
  assert.equal(jar.headerFor('https://a.example.test/ws'), '');
  assert.equal(jar.headerFor('https://b.example.test/api/auth/callback'), '');

  jar.store('https://a.example.test/api/auth/callback', ['d7_login=; Path=/api/auth; Max-Age=0']);
  assert.equal(jar.headerFor('https://a.example.test/api/auth/callback'), '');
});

test('path matching follows the segment boundary', () => {
  assert.equal(pathMatches('/api/auth/x', '/api/auth'), true);
  assert.equal(pathMatches('/api/authz', '/api/auth'), false);
  assert.equal(pathMatches('/anything', '/'), true);
});

test('a session is issued when the callback sets a value that is not removed', () => {
  assert.equal(issuedSession(['d7_login=; Max-Age=0; Path=/auth', 'd7_session=abc; Path=/']), true);
  assert.equal(issuedSession(['d7_login=; Max-Age=0; Path=/auth']), false);
  assert.equal(issuedSession([]), false);
});

// Step 3 (video meeting), checked by name. The professional creates the meeting. The client
// must read the same provider and address, and a second POST must answer 200 with the same
// address. A meeting stored in memory by the in-process stack backs all three requests.
const withFetch = async (answers, run) => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, init = {}) => {
    seen.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
    const answer = answers.shift();
    return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
  try {
    return await run(seen);
  } finally {
    global.fetch = original;
  }
};

function videoContext() {
  const jar = { headerFor: () => '', store: () => {} };
  return {
    origin: 'http://127.0.0.1:1',
    appointmentId: 'a1',
    api: (route) => `http://127.0.0.1:1${route}`,
    people: { professional: { id: 'p', jar }, client: { id: 'c', jar } },
  };
}

const ROOM = { provider: 'jitsi', url: 'https://jitsi.example.test/doctor7-room' };
const videoStep = STEPS.find((step) => step.name === 'video meeting');

test('the video step checks that the client reads the same room and that a repeated POST is idempotent', async () => {
  const ctx = videoContext();
  const detail = await withFetch(
    [{ status: 201, json: ROOM }, { status: 200, json: ROOM }, { status: 200, json: ROOM }],
    async (seen) => {
      const text = await videoStep.run(ctx);
      assert.deepEqual(seen, [
        'POST /appointments/a1/meeting',
        'GET /appointments/a1/meeting',
        'POST /appointments/a1/meeting',
      ]);
      return text;
    }
  );
  assert.match(detail, /^meeting created, provider jitsi; the client reads the same room/);
  assert.equal(ctx.meetingProvider, 'jitsi');
  assertNoLeak(detail);
});

test('the video step fails by name when the client gets another address, another provider, or no meeting', async () => {
  const cases = [
    [{ status: 200, json: { ...ROOM, url: 'https://jitsi.example.test/doctor7-other' } }, /the client did not get the same provider and address/],
    [{ status: 200, json: { provider: 'meet', url: ROOM.url } }, /the client did not get the same provider and address/],
    [{ status: 404, json: { error: { code: 'no_meeting', message: 'x' } } }, /the client could not read the meeting \(HTTP 404, no_meeting\)/],
  ];
  for (const [clientAnswer, expected] of cases) {
    await withFetch([{ status: 201, json: ROOM }, clientAnswer], async () => {
      await assert.rejects(videoStep.run(videoContext()), (err) => {
        assert.ok(err instanceof SmokeFailure);
        assert.match(err.message, expected);
        assertNoLeak(err.message);
        return true;
      });
    });
  }
});

test('the video step fails by name when the repeated POST is not a 200 with the same address', async () => {
  const cases = [
    [{ status: 201, json: ROOM }, /the repeated request did not answer 200 \(HTTP 201, none\)/],
    [{ status: 200, json: { ...ROOM, url: 'https://jitsi.example.test/doctor7-new' } }, /the repeated request did not return the same meeting/],
  ];
  for (const [repeatAnswer, expected] of cases) {
    await withFetch([{ status: 201, json: ROOM }, { status: 200, json: ROOM }, repeatAnswer], async () => {
      await assert.rejects(videoStep.run(videoContext()), (err) => {
        assert.match(err.message, expected);
        return true;
      });
    });
  }
});

test('the steps keep their order, and every dependency points at an earlier step', () => {
  assert.equal(STEPS.length, 7);
  STEPS.forEach((step, index) => {
    for (const dependency of step.requires) {
      assert.ok(dependency < index + 1, `${step.name} requires a later step`);
    }
  });
});
