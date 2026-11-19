'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter, MAX_TRACKED_KEYS } = require('./rate-limit');

function clock(startMs = 0) {
  const state = { ms: startMs };
  return { now: () => new Date(state.ms), advance: (ms) => (state.ms += ms) };
}

test('allows up to max requests in a window, then refuses', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, now: clock().now });
  assert.deepEqual(limiter.hit('a'), { allowed: true, retryAfterSeconds: 0 });
  assert.equal(limiter.hit('a').allowed, true);
  const refused = limiter.hit('a');
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 60);
});

test('keys are counted apart', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock().now });
  assert.equal(limiter.hit('198.51.100.7').allowed, true);
  assert.equal(limiter.hit('198.51.100.7').allowed, false);
  assert.equal(limiter.hit('198.51.100.8').allowed, true);
});

test('a new window starts after windowMs, and Retry-After counts down', () => {
  const time = clock(0);
  const limiter = createRateLimiter({ windowMs: 10000, max: 1, now: time.now });
  limiter.hit('a');
  time.advance(4000);
  assert.equal(limiter.hit('a').retryAfterSeconds, 6);
  time.advance(6000);
  assert.deepEqual(limiter.hit('a'), { allowed: true, retryAfterSeconds: 0 });
});

test('the number of tracked keys stays bounded', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock().now });
  for (let i = 0; i < MAX_TRACKED_KEYS + 50; i += 1) {
    limiter.hit(`key-${i}`);
  }
  assert.ok(limiter.size() <= MAX_TRACKED_KEYS);
});

test('invalid limits are rejected', () => {
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), TypeError);
  assert.throws(() => createRateLimiter({ windowMs: 1000, max: 0 }), TypeError);
  assert.throws(() => createRateLimiter({ windowMs: 1.5, max: 1 }), TypeError);
});
