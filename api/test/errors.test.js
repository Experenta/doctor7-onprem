'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { ApiError, createErrorHandler } = require('../src/http/errors');
const { listen } = require('./helpers');

function appThatThrows(error) {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  return app;
}

test('an ApiError becomes its own status and code in the uniform JSON shape', async () => {
  const logged = [];
  const app = appThatThrows(new ApiError(409, 'conflict', 'Conflict.'));
  app.use(createErrorHandler({ logger: { error: (err) => logged.push(err) } }));
  const server = await listen(app);
  try {
    const res = await fetch(`${server.url}/boom`);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: { code: 'conflict', message: 'Conflict.' } });
    assert.equal(logged.length, 0, 'expected ApiError responses are not logged as failures');
  } finally {
    await server.close();
  }
});

test('an unexpected error returns a generic 500 and is logged, not sent', async () => {
  const logged = [];
  const failure = new Error('SELECT secret FROM internal_table');
  const app = appThatThrows(failure);
  app.use(createErrorHandler({ logger: { error: (err) => logged.push(err) } }));
  const server = await listen(app);
  try {
    const res = await fetch(`${server.url}/boom`);
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'internal_error', message: 'Internal server error.' },
    });
    assert.ok(!text.includes('internal_table'), 'driver detail leaked');
    assert.ok(!/\n\s+at\s/.test(text), 'stack trace leaked');
    assert.deepEqual(logged, [failure]);
  } finally {
    await server.close();
  }
});

test('an error after the response started is passed on to Express', async () => {
  const app = express();
  app.get('/late', (req, res, next) => {
    res.write('partial');
    next(new Error('after headers'));
  });
  let received = null;
  app.use(createErrorHandler({ logger: { error() {} } }));
  app.use((err, req, res, next) => {
    received = err;
    res.end();
  });
  const server = await listen(app);
  try {
    await fetch(`${server.url}/late`).then((res) => res.text());
    assert.equal(received && received.message, 'after headers');
  } finally {
    await server.close();
  }
});
