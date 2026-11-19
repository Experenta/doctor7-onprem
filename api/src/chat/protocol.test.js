'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_BODY_BYTES, parseClientMessage, toWireMessage } = require('./protocol');

test('a well-formed message is accepted with its body unchanged', () => {
  assert.deepEqual(parseClientMessage('{"type":"message","body":"  Hello  "}'), { ok: true, body: '  Hello  ' });
});

test('frames that are not one JSON object of the agreed shape are refused as invalid_message', () => {
  const invalid = [
    'not json',
    '[]',
    'null',
    '"text"',
    '{"type":"message"}',
    '{"type":"message","body":42}',
    '{"type":"message","body":"   "}',
    '{"type":"message","body":""}',
    '{"type":"typing","body":"x"}',
    '{"type":"message","body":"x","senderId":"u-cli1"}',
  ];
  for (const text of invalid) {
    assert.deepEqual(parseClientMessage(text), { ok: false, code: 'invalid_message' }, text);
  }
});

test('the limit counts UTF-8 bytes: exactly MAX_BODY_BYTES is accepted, one more byte is refused', () => {
  const ascii = 'x'.repeat(MAX_BODY_BYTES);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'message', body: ascii })).ok, true);

  const tooLong = 'x'.repeat(MAX_BODY_BYTES + 1);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'message', body: tooLong })), {
    ok: false,
    code: 'message_too_large',
  });
});

test('a body of two-byte characters is limited by its bytes, not its characters', () => {
  const twoByte = 'ñ'.repeat(MAX_BODY_BYTES / 2);
  assert.equal(Buffer.byteLength(twoByte, 'utf8'), MAX_BODY_BYTES);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'message', body: twoByte })).ok, true);

  const over = 'ñ'.repeat(MAX_BODY_BYTES / 2 + 1);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'message', body: over })), {
    ok: false,
    code: 'message_too_large',
  });
});

test('a wire message carries only the agreed fields, with sentAt in ISO 8601 UTC', () => {
  const wire = toWireMessage({
    id: 'm-1',
    appointmentId: 'a1',
    senderId: 'u-cli1',
    body: 'Hello',
    sentAt: new Date('2026-12-01T15:00:00.123Z'),
    storageOnly: 'never sent',
  });
  assert.deepEqual(wire, {
    id: 'm-1',
    appointmentId: 'a1',
    senderId: 'u-cli1',
    body: 'Hello',
    sentAt: '2026-12-01T15:00:00.123Z',
  });
});
