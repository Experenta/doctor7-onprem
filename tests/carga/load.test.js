'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runLoad, percentile, DEFAULTS } = require('./load');

test('percentile uses the nearest-rank method, and refuses an empty list or a bad p', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 50), 5);
  assert.equal(percentile(sorted, 95), 10);
  assert.equal(percentile(sorted, 100), 10);
  assert.equal(percentile([7], 95), 7);
  assert.throws(() => percentile([], 50), RangeError);
  assert.throws(() => percentile(sorted, 0), RangeError);
  assert.throws(() => percentile(sorted, 101), RangeError);
});

test('the generator refuses a load outside its limits before it starts a server', async () => {
  await assert.rejects(() => runLoad({ requests: 0 }), RangeError);
  await assert.rejects(() => runLoad({ concurrency: 65 }), RangeError);
  await assert.rejects(() => runLoad({ requests: 1.5 }), RangeError);
});

test('a request with a wrong session counts as an error, so errors are never hidden', async () => {
  const report = await runLoad({ requests: 6, concurrency: 2, token: 'not-a-session' });
  assert.equal(report.errors, 6);
});

test('the default load succeeds on every request and reports p50 and p95', async (t) => {
  const report = await runLoad();
  t.diagnostic(
    `load: ${report.requests} requests, concurrency ${report.concurrency}, ` +
      `p50 ${report.p50Ms} ms, p95 ${report.p95Ms} ms, ${report.errors} errors, ${report.durationMs} ms total`
  );
  assert.equal(report.requests, DEFAULTS.requests);
  assert.equal(report.errors, 0);
  assert.ok(report.p50Ms <= report.p95Ms, 'p50 must not be above p95');
});
