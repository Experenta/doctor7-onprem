'use strict';

// Wire format and limits of the chat channel. Every frame is JSON text.
//
// Client to server: {"type":"message","body":"<text>"}
// Server to client: {"type":"history","items":[<message>, ...]} once after connect
//                   {"type":"message","message":<message>} for each stored message
//                   {"type":"error","error":{"code":"<code>","message":"<text>"}}
// A <message> is {"id","appointmentId","senderId","body","sentAt"}. sentAt is ISO 8601 UTC.

const MAX_BODY_BYTES = 2000;
const MAX_FRAME_BYTES = 16 * 1024;
const HISTORY_LIMIT = 50;

// WebSocket close codes in the application range (4000 to 4999).
const CLOSE = Object.freeze({
  APPOINTMENT_CLOSED: Object.freeze({ code: 4001, reason: 'appointment_closed' }),
  SESSION_ENDED: Object.freeze({ code: 4002, reason: 'session_ended' }),
  ACCESS_LOST: Object.freeze({ code: 4003, reason: 'access_lost' }),
});

// Text sent with each error frame. It is fixed, so no internal detail reaches a client.
const ERROR_TEXT = Object.freeze({
  invalid_message: 'The message must be a JSON object with type "message" and a non-empty body.',
  message_too_large: `The message body must be at most ${MAX_BODY_BYTES} bytes of UTF-8.`,
  appointment_closed: 'This appointment is closed, so the chat is closed.',
  session_ended: 'The session has ended.',
  access_lost: 'This account may no longer use this chat.',
  server_error: 'The message could not be processed.',
});

const CLIENT_KEYS = Object.freeze(['type', 'body']);

function refused(code) {
  return { ok: false, code };
}

// Checks one text frame from a client. Returns { ok: true, body } or { ok: false, code }.
// The size check counts UTF-8 bytes, not characters.
function parseClientMessage(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return refused('invalid_message');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refused('invalid_message');
  }
  for (const key of Object.keys(value)) {
    if (!CLIENT_KEYS.includes(key)) return refused('invalid_message');
  }
  if (value.type !== 'message' || typeof value.body !== 'string' || value.body.trim().length === 0) {
    return refused('invalid_message');
  }
  if (Buffer.byteLength(value.body, 'utf8') > MAX_BODY_BYTES) {
    return refused('message_too_large');
  }
  return { ok: true, body: value.body };
}

// The message as it goes over the wire. Only these fields leave the server.
function toWireMessage(message) {
  return {
    id: message.id,
    appointmentId: message.appointmentId,
    senderId: message.senderId,
    body: message.body,
    sentAt: message.sentAt.toISOString(),
  };
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_FRAME_BYTES,
  HISTORY_LIMIT,
  CLOSE,
  ERROR_TEXT,
  parseClientMessage,
  toWireMessage,
};
