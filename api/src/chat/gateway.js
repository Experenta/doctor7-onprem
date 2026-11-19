'use strict';

const { randomUUID } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');
const { resolveSession } = require('../auth/requestSession');
const { createSequencer } = require('./sequence');
const { chatDenialReason, isClosed } = require('./access');
const {
  CLOSE,
  ERROR_TEXT,
  HISTORY_LIMIT,
  MAX_FRAME_BYTES,
  parseClientMessage,
  toWireMessage,
} = require('./protocol');

const PATH = '/ws';
const ID_MAX_LENGTH = 64;
const DEFAULT_SWEEP_MS = 30 * 1000;
const SERVER_SHUTDOWN = Object.freeze({ code: 1001, reason: 'server_shutdown' });
const INTERNAL_ERROR = Object.freeze({ code: 1011, reason: 'server_error' });

const STATUS_TEXT = Object.freeze({
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  410: 'Gone',
  500: 'Internal Server Error',
});

function isId(value) {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= ID_MAX_LENGTH;
}

// Answers a handshake that is refused before the upgrade. The body has the API
// error shape. Nothing else from the request is echoed back.
function rejectUpgrade(socket, status, code, message) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error: { code, message } });
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      'Cache-Control: no-store\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body
  );
}

// A browser sends Origin on every WebSocket handshake. The host it names must
// be the host of the Host header. A handshake without Origin comes from a
// non-browser client, which is still checked by the session cookie.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof req.headers.host !== 'string') return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function ipOf(req) {
  return req.socket.remoteAddress ?? null;
}

// Builds the WebSocket server for the chat. `audit` is required. The store and
// careStore follow the contracts in store.js and in ../care/store.js.
function createChatGateway({
  store,
  careStore,
  sessions,
  audit,
  cookieName,
  newId = randomUUID,
  now = () => new Date(),
  logger = console,
  sweepIntervalMs = DEFAULT_SWEEP_MS,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const sequencer = createSequencer({ now });
  const rooms = new Map(); // appointment id -> Set of connections that have their history
  const connections = new Set(); // every accepted connection, open or closing
  let timer = null;

  function leave(conn) {
    connections.delete(conn);
    const room = rooms.get(conn.appointmentId);
    if (!room) return;
    room.delete(conn);
    if (room.size === 0) rooms.delete(conn.appointmentId);
  }

  function join(conn) {
    if (conn.closed) return;
    const room = rooms.get(conn.appointmentId) ?? new Set();
    room.add(conn);
    rooms.set(conn.appointmentId, room);
  }

  function sendFrame(ws, frame) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  }

  function sendError(ws, code) {
    sendFrame(ws, { type: 'error', error: { code, message: ERROR_TEXT[code] } });
  }

  // Ends one connection with an application close code. It leaves the room at
  // once, so nothing more is sent to it.
  function end(conn, close) {
    if (conn.closed) return;
    conn.closed = true;
    leave(conn);
    conn.ws.close(close.code, close.reason);
  }

  function recordConnect(req, user, { centerId, targetId }, outcome, reason) {
    return audit.record({
      actorId: user.id,
      centerId,
      ip: ipOf(req),
      action: 'chat.connect',
      targetType: 'appointment',
      targetId,
      outcome,
      reason,
    });
  }

  function recordSend(conn, appointment, outcome, reason) {
    return audit.record({
      actorId: conn.user.id,
      centerId: appointment.centerId,
      ip: conn.ip,
      action: 'chat.send',
      targetType: 'appointment',
      targetId: appointment.id,
      outcome,
      reason,
    });
  }

  // Handles one inbound frame. It runs in the appointment queue, so frames of
  // one appointment are checked, stored, and broadcast one at a time.
  async function handleFrame(conn, data, isBinary) {
    if (conn.closed) return;

    const auth = await sessions.authenticate(conn.token);
    if (!auth) {
      end(conn, CLOSE.SESSION_ENDED);
      return;
    }

    const appointment = await careStore.findAppointment(conn.appointmentId);
    if (!appointment) {
      end(conn, CLOSE.ACCESS_LOST);
      return;
    }
    const denial = chatDenialReason(conn.user, appointment);
    if (denial) {
      await recordSend(conn, appointment, 'denied', denial);
      sendError(conn.ws, 'access_lost');
      end(conn, CLOSE.ACCESS_LOST);
      return;
    }
    if (isClosed(appointment)) {
      await recordSend(conn, appointment, 'denied', 'appointment_closed');
      sendError(conn.ws, 'appointment_closed');
      end(conn, CLOSE.APPOINTMENT_CLOSED);
      return;
    }

    if (isBinary) {
      sendError(conn.ws, 'invalid_message');
      return;
    }
    const parsed = parseClientMessage(data.toString('utf8'));
    if (!parsed.ok) {
      sendError(conn.ws, parsed.code);
      return;
    }

    const message = {
      id: newId(),
      appointmentId: appointment.id,
      senderId: conn.user.id,
      body: parsed.body,
      sentAt: sequencer.stamp(appointment.id),
    };
    await store.insertMessage(message);
    await recordSend(conn, appointment, 'success');

    const frame = { type: 'message', message: toWireMessage(message) };
    for (const target of rooms.get(appointment.id) ?? []) {
      sendFrame(target.ws, frame);
    }
  }

  // Runs after the upgrade. The join is queued in the appointment queue, so the
  // history frame goes out before any broadcast the connection receives. A
  // message stored before the join is in the history. One stored after it is
  // sent live. Neither case repeats or misses a message.
  function accept(conn, appointment) {
    const { ws } = conn;
    connections.add(conn);

    sequencer
      .run(appointment.id, async () => {
        if (conn.closed) return;
        const items = await store.listRecent(appointment.id, HISTORY_LIMIT);
        sendFrame(ws, { type: 'history', items: items.map(toWireMessage) });
        join(conn);
      })
      .catch((err) => {
        logger.error(err);
        end(conn, INTERNAL_ERROR);
      });

    ws.on('message', (data, isBinary) => {
      sequencer.run(appointment.id, () => handleFrame(conn, data, isBinary)).catch((err) => {
        logger.error(err);
        sendError(ws, 'server_error');
      });
    });
    ws.on('close', () => {
      conn.closed = true;
      leave(conn);
    });
    ws.on('error', () => {
      logger.warn?.('Chat connection error.');
    });
  }

  // Runs the handshake checks in order (see design.md). `state.upgraded` tells
  // the caller whether the socket already belongs to WebSocket.
  async function upgrade(req, socket, head, state) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) {
      rejectUpgrade(socket, 404, 'not_found', 'Resource not found.');
      return;
    }
    if (!isSameOrigin(req)) {
      rejectUpgrade(socket, 403, 'forbidden', 'This origin may not open the chat.');
      return;
    }

    const { auth, token } = await resolveSession(sessions, req.headers.cookie, cookieName);
    if (!auth) {
      rejectUpgrade(socket, 401, 'unauthenticated', 'Sign-in is required.');
      return;
    }
    const { user } = auth;

    const appointmentId = url.searchParams.get('appointment');
    if (!isId(appointmentId)) {
      rejectUpgrade(socket, 400, 'invalid_request', 'The appointment parameter is required.');
      return;
    }

    const appointment = await careStore.findAppointment(appointmentId);
    if (!appointment) {
      await recordConnect(req, user, { centerId: user.centerId, targetId: appointmentId }, 'denied', 'not_found');
      rejectUpgrade(socket, 404, 'not_found', 'Resource not found.');
      return;
    }
    const denial = chatDenialReason(user, appointment);
    if (denial) {
      await recordConnect(req, user, { centerId: appointment.centerId, targetId: appointment.id }, 'denied', denial);
      rejectUpgrade(socket, 404, 'not_found', 'Resource not found.');
      return;
    }
    if (isClosed(appointment)) {
      await recordConnect(
        req,
        user,
        { centerId: appointment.centerId, targetId: appointment.id },
        'denied',
        'appointment_closed'
      );
      rejectUpgrade(socket, 410, 'appointment_closed', ERROR_TEXT.appointment_closed);
      return;
    }

    await recordConnect(req, user, { centerId: appointment.centerId, targetId: appointment.id }, 'success');
    wss.handleUpgrade(req, socket, head, (ws) => {
      state.upgraded = true;
      const conn = { ws, user, token, ip: ipOf(req), appointmentId: appointment.id, closed: false };
      accept(conn, appointment);
    });
  }

  function onUpgrade(req, socket, head) {
    const state = { upgraded: false };
    upgrade(req, socket, head, state).catch((err) => {
      logger.error(err);
      if (state.upgraded) {
        socket.destroy();
      } else {
        rejectUpgrade(socket, 500, 'internal_error', 'Unexpected error.');
      }
    });
  }

  // Closes the connections whose session or appointment is no longer valid.
  // Each check sees the current state, so a change takes effect within one sweep.
  async function sweep() {
    for (const conn of [...connections]) {
      if (conn.closed) continue;
      try {
        const auth = await sessions.authenticate(conn.token);
        if (!auth) {
          end(conn, CLOSE.SESSION_ENDED);
          continue;
        }
        const appointment = await careStore.findAppointment(conn.appointmentId);
        if (!appointment || chatDenialReason(conn.user, appointment)) {
          end(conn, CLOSE.ACCESS_LOST);
        } else if (isClosed(appointment)) {
          end(conn, CLOSE.APPOINTMENT_CLOSED);
        }
      } catch (err) {
        // The connection stays open, and the next sweep checks it again.
        logger.error(err);
      }
    }
  }

  // Connects the gateway to an HTTP server. Starts the sweep timer.
  function attach(server) {
    server.on('upgrade', onUpgrade);
    if (sweepIntervalMs > 0 && timer === null) {
      timer = setInterval(() => {
        sweep().catch((err) => logger.error(err));
      }, sweepIntervalMs);
      timer.unref();
    }
    return server;
  }

  // Stops the sweep and closes every open connection.
  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const conn of [...connections]) {
      end(conn, SERVER_SHUTDOWN);
    }
    wss.close();
  }

  return { attach, sweep, close };
}

module.exports = { createChatGateway, rejectUpgrade, isSameOrigin };
