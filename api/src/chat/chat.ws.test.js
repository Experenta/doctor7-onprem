'use strict';

// Integration tests of the chat over real WebSocket connections. Each test starts
// its own server, so state never leaks between tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { startChat, entriesFor, Refusal, waitUntil } = require('./harness');

async function withChat(options, fn) {
  const ctx = await startChat(options);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

// Resolves with the Refusal of a handshake that the server must refuse.
async function refusalOf(promise) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Refusal) return err;
    throw err;
  }
  throw new Error('The handshake was accepted, but a refusal was expected.');
}

// The frames of one type received so far, in arrival order.
function framesOf(client, type) {
  return client.frames.filter((frame) => frame.type === type);
}

test('a caller who is not a participant cannot connect, and every refusal has the same body as a missing appointment', () =>
  withChat({}, async (ctx) => {
    const missing = await refusalOf(ctx.connect('u-pro1', 'no-such-id'));
    assert.equal(missing.status, 404);

    const cases = [
      ['u-adm1', 'a1'],
      ['u-aud1', 'a1'],
      ['u-pro1b', 'a1'],
      ['u-cli1b', 'a1'],
      ['u-pro2', 'a1'],
      ['u-cli2', 'a1'],
    ];
    for (const [as, id] of cases) {
      const refusal = await refusalOf(ctx.connect(as, id));
      assert.equal(refusal.status, 404, `${as} on ${id}`);
      assert.equal(refusal.body, missing.body, `${as} on ${id} gets the same body`);
    }

    // The audit log keeps the real reason, which the caller never sees.
    const denied = entriesFor(ctx.auditStore, 'chat.connect').filter((entry) => entry.outcome === 'denied');
    const reasonOf = (actorId, targetId) =>
      denied.find((entry) => entry.actorId === actorId && entry.targetId === targetId);
    assert.equal(reasonOf('u-adm1', 'a1').reason, 'not_participant');
    assert.equal(reasonOf('u-aud1', 'a1').reason, 'role_not_allowed');
    assert.equal(reasonOf('u-pro1b', 'a1').reason, 'not_participant');
    assert.equal(reasonOf('u-cli1b', 'a1').reason, 'not_participant');
    assert.equal(reasonOf('u-pro2', 'a1').reason, 'other_center');
    assert.equal(reasonOf('u-cli2', 'a1').reason, 'other_center');
    assert.equal(reasonOf('u-pro1', 'no-such-id').reason, 'not_found');
    assert.equal(reasonOf('u-adm1', 'a1').centerId, 'c1');
  }));

test('a handshake without a live session is refused with 401 and writes no audit entry', () =>
  withChat({}, async (ctx) => {
    assert.equal((await refusalOf(ctx.connect('u-pro1', 'a1', { cookie: null }))).status, 401);
    assert.equal((await refusalOf(ctx.connect('u-pro1', 'a1', { cookie: 'd7_session=made-up-token' }))).status, 401);
    assert.equal(entriesFor(ctx.auditStore, 'chat.connect').length, 0);
  }));

test('a participant connects, the first frame is the history, and the connection is audited', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const cli = await ctx.connect('u-cli1', 'a1');
    const history = await pro.take('history');
    assert.deepEqual(history.items, []);
    assert.equal(pro.frames[0].type, 'history');
    await cli.take('history');

    const connects = entriesFor(ctx.auditStore, 'chat.connect').filter((entry) => entry.outcome === 'success');
    assert.deepEqual(
      connects.map((entry) => [entry.actorId, entry.targetId, entry.centerId, entry.reason]),
      [
        ['u-pro1', 'a1', 'c1', null],
        ['u-cli1', 'a1', 'c1', null],
      ]
    );
  }));

test('a professional and a client exchange messages, and both receive each one with its sender', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const cli = await ctx.connect('u-cli1', 'a1');
    await pro.take('history');
    await cli.take('history');

    pro.send({ type: 'message', body: 'Hello from the professional' });
    const toClient = await cli.take('message');
    assert.equal(toClient.message.body, 'Hello from the professional');
    assert.equal(toClient.message.senderId, 'u-pro1');
    assert.equal(toClient.message.appointmentId, 'a1');
    assert.match(toClient.message.sentAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const echo = await pro.take('message');
    assert.equal(echo.message.id, toClient.message.id);

    cli.send({ type: 'message', body: 'Hello from the client' });
    const reply = await pro.take('message');
    assert.equal(reply.message.senderId, 'u-cli1');

    assert.deepEqual(
      ctx.chatStore.messages.map((message) => [message.senderId, message.body]),
      [
        ['u-pro1', 'Hello from the professional'],
        ['u-cli1', 'Hello from the client'],
      ]
    );
  }));

test('each stored message writes one chat.send entry, and no entry holds the text', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    pro.send({ type: 'message', body: 'Confidential synthetic text' });
    await pro.take('message');

    const sends = entriesFor(ctx.auditStore, 'chat.send');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].outcome, 'success');
    assert.equal(sends[0].actorId, 'u-pro1');
    assert.equal(sends[0].targetId, 'a1');
    assert.equal(sends[0].centerId, 'c1');
    assert.equal(sends[0].reason, null);
    assert.ok(!JSON.stringify(ctx.auditStore.entries).includes('Confidential synthetic text'));
  }));

test('a message over the size limit is refused, not stored, not sent, and the connection stays open', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const cli = await ctx.connect('u-cli1', 'a1');
    await pro.take('history');
    await cli.take('history');

    pro.send({ type: 'message', body: 'x'.repeat(2001) });
    const error = await pro.take('error');
    assert.equal(error.error.code, 'message_too_large');
    assert.equal(ctx.chatStore.messages.length, 0);
    assert.equal(pro.ws.readyState, WebSocket.OPEN);

    pro.send({ type: 'message', body: 'still here' });
    const received = await cli.take('message');
    assert.equal(received.message.body, 'still here', 'the oversized message was not broadcast');
    assert.equal(entriesFor(ctx.auditStore, 'chat.send').length, 1);
  }));

test('frames that are not valid messages are refused as invalid_message, and the connection stays open', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');

    for (const text of ['not json', '[]', '{"type":"message","body":""}', '{"type":"other","body":"x"}']) {
      pro.send(text);
      const error = await pro.take('error');
      assert.equal(error.error.code, 'invalid_message', text);
    }
    pro.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    assert.equal((await pro.take('error')).error.code, 'invalid_message', 'binary frame');

    assert.equal(ctx.chatStore.messages.length, 0);
    assert.equal(pro.ws.readyState, WebSocket.OPEN);
  }));

test('a frame larger than 16 KiB closes the connection with code 1009', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    pro.send('x'.repeat(17 * 1024));
    const closed = await pro.closedWith();
    assert.equal(closed.code, 1009);
    assert.equal(ctx.chatStore.messages.length, 0);
  }));

test('messages from several connections keep one order in the broadcast, the storage, and the history', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const cli = await ctx.connect('u-cli1', 'a1');
    await pro.take('history');
    await cli.take('history');

    for (let index = 0; index < 15; index += 1) {
      pro.send({ type: 'message', body: `pro ${index}` });
      cli.send({ type: 'message', body: `cli ${index}` });
    }
    await waitUntil(() => (ctx.chatStore.messages.length === 30 ? true : undefined), 'thirty stored messages', 5000);
    await waitUntil(
      () => (framesOf(pro, 'message').length === 30 && framesOf(cli, 'message').length === 30 ? true : undefined),
      'thirty broadcast frames on each connection',
      5000
    );

    const stored = ctx.chatStore.messages.map((message) => message.id);
    assert.deepEqual(framesOf(pro, 'message').map((frame) => frame.message.id), stored);
    assert.deepEqual(framesOf(cli, 'message').map((frame) => frame.message.id), stored);

    const times = ctx.chatStore.messages.map((message) => message.sentAt.getTime());
    for (let index = 1; index < times.length; index += 1) {
      assert.ok(times[index] > times[index - 1], `sent_at increases at ${index}`);
    }

    const late = await ctx.connect('u-pro1', 'a1');
    const history = await late.take('history');
    assert.deepEqual(history.items.map((item) => item.id), stored);
  }));

test('a reconnecting client receives the messages sent while it was away', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    pro.ws.close();
    await pro.closedWith();

    const cli = await ctx.connect('u-cli1', 'a1');
    await cli.take('history');
    cli.send({ type: 'message', body: 'sent while away' });
    await waitUntil(() => (ctx.chatStore.messages.length === 1 ? true : undefined), 'the stored message');

    const again = await ctx.connect('u-pro1', 'a1');
    const history = await again.take('history');
    assert.deepEqual(
      history.items.map((item) => item.body),
      ['sent while away']
    );
  }));

test('the history holds the 50 most recent messages of the appointment, oldest first, and no other appointment', () => {
  const base = Date.parse('2026-11-30T12:00:00.000Z');
  const messages = [];
  for (let index = 0; index < 60; index += 1) {
    messages.push({
      id: `m-${String(index).padStart(2, '0')}`,
      appointmentId: 'a1',
      senderId: 'u-pro1',
      body: `a1 message ${index}`,
      sentAt: new Date(base + index * 1000),
    });
  }
  messages.push({ id: 'other', appointmentId: 'a2', senderId: 'u-pro1b', body: 'a2 message', sentAt: new Date(base + 99000) });
  return withChat({ messages }, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const history = await pro.take('history');
    assert.equal(history.items.length, 50);
    assert.equal(history.items[0].body, 'a1 message 10');
    assert.equal(history.items[49].body, 'a1 message 59');
    assert.ok(history.items.every((item) => item.appointmentId === 'a1'));
  });
});

test('a closed appointment refuses a new connection with 410 and writes a denied entry', () =>
  withChat({}, async (ctx) => {
    ctx.careStore.appointmentsById.get('a1').status = 'completed';
    const refusal = await refusalOf(ctx.connect('u-pro1', 'a1'));
    assert.equal(refusal.status, 410);
    assert.equal(JSON.parse(refusal.body).error.code, 'appointment_closed');

    const denied = entriesFor(ctx.auditStore, 'chat.connect').filter((entry) => entry.outcome === 'denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason, 'appointment_closed');
    assert.equal(denied[0].targetId, 'a1');
  }));

test('after the appointment closes, a new message is refused, nothing is stored, and the socket closes with 4001', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    ctx.careStore.appointmentsById.get('a1').status = 'cancelled';

    pro.send({ type: 'message', body: 'too late' });
    assert.equal((await pro.take('error')).error.code, 'appointment_closed');
    assert.equal((await pro.closedWith()).code, 4001);
    assert.equal(ctx.chatStore.messages.length, 0);

    const denied = entriesFor(ctx.auditStore, 'chat.send').filter((entry) => entry.outcome === 'denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason, 'appointment_closed');
  }));

test('a sweep closes the open connections of an appointment that closed, and leaves other appointments open', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    const cli = await ctx.connect('u-cli1', 'a1');
    const other = await ctx.connect('u-pro1b', 'a2');
    await pro.take('history');
    await cli.take('history');
    await other.take('history');

    ctx.careStore.appointmentsById.get('a1').status = 'completed';
    await ctx.chat.sweep();

    assert.equal((await pro.closedWith()).code, 4001);
    assert.equal((await cli.closedWith()).code, 4001);
    assert.equal(other.ws.readyState, WebSocket.OPEN);
  }));

test('a sweep closes the connections of a revoked session with code 4002', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    await ctx.sessions.revoke(ctx.tokens['u-pro1']);

    await ctx.chat.sweep();
    assert.equal((await pro.closedWith()).code, 4002);
    assert.equal((await refusalOf(ctx.connect('u-pro1', 'a1'))).status, 401);
  }));

test('a message from a revoked session ends the connection with 4002 and stores nothing', () =>
  withChat({}, async (ctx) => {
    const pro = await ctx.connect('u-pro1', 'a1');
    await pro.take('history');
    await ctx.sessions.revoke(ctx.tokens['u-pro1']);

    pro.send({ type: 'message', body: 'after logout' });
    assert.equal((await pro.closedWith()).code, 4002);
    assert.equal(ctx.chatStore.messages.length, 0);
  }));

test('a handshake from another origin is refused with 403, and the same host is accepted', () =>
  withChat({}, async (ctx) => {
    const refusal = await refusalOf(ctx.connect('u-pro1', 'a1', { origin: 'https://evil.example.test' }));
    assert.equal(refusal.status, 403);
    assert.equal(JSON.parse(refusal.body).error.code, 'forbidden');

    const same = await ctx.connect('u-pro1', 'a1', { origin: `http://127.0.0.1:${ctx.port}` });
    assert.equal((await same.take('history')).type, 'history');
  }));

test('a handshake without a valid appointment parameter is refused with 400', () =>
  withChat({}, async (ctx) => {
    const none = await refusalOf(ctx.connect('u-pro1', null));
    assert.equal(none.status, 400);
    assert.equal(JSON.parse(none.body).error.code, 'invalid_request');

    const empty = await refusalOf(ctx.connect('u-pro1', '', { query: '?appointment=' }));
    assert.equal(empty.status, 400);
  }));

test('a path other than /ws is refused with 404', () =>
  withChat({}, async (ctx) => {
    const refusal = await refusalOf(ctx.connect('u-pro1', 'a1', { path: '/other' }));
    assert.equal(refusal.status, 404);
  }));
