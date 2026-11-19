'use strict';

// The seven steps of the smoke. Each step checks one part of the flow and returns
// a short detail, or throws a SmokeFailure. Details name statuses, API error
// codes, and identifiers, and never a cookie, token, e-mail address, URL, or body.

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { send, SmokeFailure, safeJson, errorCode } = require('./http');
const { signIn } = require('./login');

// The chat uses the `ws` package that the API already installs. It is resolved
// from the api directory, so nothing is installed for the smoke.
const WebSocket = require(require.resolve('ws', { paths: [path.join(__dirname, '..', '..', 'api')] }));

const DAY_MS = 24 * 60 * 60 * 1000;
const MEETING_PROVIDERS = ['meet', 'jitsi'];
const CHAT_TIMEOUT_MS = 5000;

// The demo accounts of the synthetic seed, and the two accounts that must be refused.
const ACCOUNTS = Object.freeze([
  { role: 'professional', email: 'ana.rivera@example.test' },
  { role: 'client', email: 'luis.mora@example.test' },
  { role: 'admin', email: 'marta.solis@example.test' },
  { role: 'auditor', email: 'iris.vega@example.test' },
]);
const REFUSALS = Object.freeze([
  { label: 'account with no users row', email: 'no.role@example.test', status: 403 },
  { label: 'account with an unverified e-mail', email: 'pending@example.test', status: 401 },
]);

const enc = (value) => encodeURIComponent(value);

// Opens one chat socket and returns a client for it. Frames are queued, so a frame
// that arrives before the caller asks for it is kept.
function openChat(url, { cookie, origin }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Cookie: cookie, Origin: origin },
      handshakeTimeout: CHAT_TIMEOUT_MS,
    });
    const inbox = [];
    const waiting = [];

    socket.on('message', (data) => {
      const frame = safeJson(data.toString('utf8'));
      if (!frame || typeof frame.type !== 'string') return;
      const index = waiting.findIndex((entry) => entry.type === frame.type);
      if (index >= 0) {
        waiting.splice(index, 1)[0].resolve(frame);
      } else {
        inbox.push(frame);
      }
    });
    // Errors after the handshake show up as frames that never come, so the wait times out.
    socket.on('error', () => {});
    socket.once('unexpected-response', (req, res) => {
      res.resume();
      socket.terminate();
      reject(new SmokeFailure(`the chat handshake was refused (HTTP ${res.statusCode})`));
    });
    socket.once('open', () => {
      resolve({
        next(type, timeoutMs = CHAT_TIMEOUT_MS) {
          const index = inbox.findIndex((frame) => frame.type === type);
          if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
          return new Promise((resolveNext, rejectNext) => {
            const entry = {
              type,
              resolve: (frame) => {
                clearTimeout(timer);
                resolveNext(frame);
              },
            };
            const timer = setTimeout(() => {
              const at = waiting.indexOf(entry);
              if (at >= 0) waiting.splice(at, 1);
              rejectNext(new SmokeFailure(`no "${type}" frame from the chat within ${timeoutMs} ms`));
            }, timeoutMs);
            waiting.push(entry);
          });
        },
        send(frame) {
          socket.send(JSON.stringify(frame));
        },
        close() {
          socket.terminate();
        },
      });
    });
  });
}

// Step 1. Each demo account signs in and reads its role. The two refused accounts
// must get their status and no session.
async function signInAll(ctx) {
  for (const account of ACCOUNTS) {
    const result = await signIn(ctx, account.email);
    if (result.status !== 302 || !result.sessionIssued) {
      throw new SmokeFailure(`${account.role} sign-in failed (HTTP ${result.status})`);
    }
    const me = await send(ctx.api('/auth/me'), { jar: result.jar });
    const body = safeJson(me.text);
    if (me.status !== 200 || !body || !body.user || typeof body.user.id !== 'string') {
      throw new SmokeFailure(`${account.role}: /auth/me answered HTTP ${me.status}`);
    }
    if (body.user.role !== account.role) {
      throw new SmokeFailure(`${account.role}: /auth/me shows another role`);
    }
    ctx.people[account.role] = { id: body.user.id, jar: result.jar };
  }
  for (const refusal of REFUSALS) {
    const result = await signIn(ctx, refusal.email);
    if (result.status !== refusal.status || result.sessionIssued) {
      throw new SmokeFailure(`${refusal.label} was not refused with HTTP ${refusal.status}`);
    }
  }
  return `4 demo roles signed in; ${REFUSALS.length} refusals as expected`;
}

// Step 2, write mode. The professional creates a scheduled appointment with the client.
async function createAppointment(ctx) {
  const { professional, client } = ctx.people;
  const startsMs = Date.now() + 30 * DAY_MS;
  const res = await send(ctx.api('/appointments'), {
    method: 'POST',
    jar: professional.jar,
    origin: ctx.origin,
    json: {
      professionalId: professional.id,
      clientId: client.id,
      startsAt: new Date(startsMs).toISOString(),
      endsAt: new Date(startsMs + 50 * 60 * 1000).toISOString(),
    },
  });
  const body = safeJson(res.text);
  if (res.status !== 201 || !body || typeof body.id !== 'string' || body.status !== 'scheduled') {
    throw new SmokeFailure(`the appointment was not created (HTTP ${res.status}, ${errorCode(res.text)})`);
  }
  ctx.appointmentId = body.id;
  return `appointment ${body.id} created, status scheduled`;
}

// Step 2, read-only mode. Lists the professional's appointments and reads the first one.
async function readAppointment(ctx) {
  const { professional } = ctx.people;
  const list = await send(ctx.api('/appointments?limit=20'), { jar: professional.jar });
  const body = safeJson(list.text);
  if (list.status !== 200 || !body || !Array.isArray(body.items)) {
    throw new SmokeFailure(`the appointment list was not read (HTTP ${list.status})`);
  }
  if (body.items.length === 0 || typeof body.items[0].id !== 'string') {
    throw new SmokeFailure('the appointment list is empty, so there is no appointment to read');
  }
  const id = body.items[0].id;
  const one = await send(ctx.api(`/appointments/${enc(id)}`), { jar: professional.jar });
  const item = safeJson(one.text);
  if (one.status !== 200 || !item || item.id !== id) {
    throw new SmokeFailure(`the appointment was not read back (HTTP ${one.status})`);
  }
  ctx.appointmentId = id;
  return `appointment ${id} listed and read (read-only)`;
}

// Step 3. The professional creates the video meeting. Meet or Jitsi both pass. Then the
// client reads the stored meeting and must get the same provider and the same address,
// and a second request of the professional must answer 200 with the same address.
// The answers are compared and never printed, because the address can hold a token.
async function createMeeting(ctx) {
  const route = ctx.api(`/appointments/${enc(ctx.appointmentId)}/meeting`);
  const { professional, client } = ctx.people;

  const res = await send(route, { method: 'POST', jar: professional.jar, origin: ctx.origin, json: {} });
  if (res.status !== 201) {
    throw new SmokeFailure(`the meeting was not created (HTTP ${res.status}, ${errorCode(res.text)})`);
  }
  const body = safeJson(res.text);
  if (!body || !MEETING_PROVIDERS.includes(body.provider) || typeof body.url !== 'string' || body.url === '') {
    throw new SmokeFailure('the meeting answer has an unexpected shape');
  }

  const read = await send(route, { jar: client.jar });
  if (read.status !== 200) {
    throw new SmokeFailure(`the client could not read the meeting (HTTP ${read.status}, ${errorCode(read.text)})`);
  }
  const seen = safeJson(read.text);
  if (!seen || seen.provider !== body.provider || seen.url !== body.url) {
    throw new SmokeFailure('the client did not get the same provider and address as the professional');
  }

  const again = await send(route, { method: 'POST', jar: professional.jar, origin: ctx.origin, json: {} });
  if (again.status !== 200) {
    throw new SmokeFailure(`the repeated request did not answer 200 (HTTP ${again.status}, ${errorCode(again.text)})`);
  }
  const same = safeJson(again.text);
  if (!same || same.provider !== body.provider || same.url !== body.url) {
    throw new SmokeFailure('the repeated request did not return the same meeting');
  }

  ctx.meetingProvider = body.provider;
  return `meeting created, provider ${body.provider}; the client reads the same room; a repeated request returns it unchanged`;
}

// Step 4. The professional sends a message, and both participants receive it.
async function chatRoundTrip(ctx) {
  const { professional, client } = ctx.people;
  const url = `${ctx.wsBase}/ws?appointment=${enc(ctx.appointmentId)}`;
  const text = `${ctx.tag} chat message`;
  const sockets = [];
  try {
    const proChat = await openChat(url, { cookie: professional.jar.headerFor(url), origin: ctx.origin });
    sockets.push(proChat);
    const clientChat = await openChat(url, { cookie: client.jar.headerFor(url), origin: ctx.origin });
    sockets.push(clientChat);

    await proChat.next('history');
    await clientChat.next('history');
    proChat.send({ type: 'message', body: text });
    const frames = await Promise.all([proChat.next('message'), clientChat.next('message')]);
    for (const frame of frames) {
      if (!frame.message || frame.message.body !== text || frame.message.senderId !== professional.id) {
        throw new SmokeFailure('a participant received a different message');
      }
    }
    return 'message sent by the professional and read by both participants';
  } finally {
    for (const socket of sockets) socket.close();
  }
}

// Step 5. The professional creates a consultation record. Its note starts with the run tag.
async function createConsultation(ctx) {
  const note = `${ctx.tag} consultation note`;
  const res = await send(ctx.api('/consultations'), {
    method: 'POST',
    jar: ctx.people.professional.jar,
    origin: ctx.origin,
    json: { appointmentId: ctx.appointmentId, body: { note } },
  });
  const body = safeJson(res.text);
  if (res.status !== 201 || !body || typeof body.id !== 'string') {
    throw new SmokeFailure(`the consultation record was not created (HTTP ${res.status}, ${errorCode(res.text)})`);
  }
  ctx.consultationId = body.id;
  ctx.consultationNote = note;
  return `consultation record ${body.id} created on appointment ${ctx.appointmentId}`;
}

// Step 6. The professional reads the record back, and the note matches.
async function readConsultation(ctx) {
  const res = await send(ctx.api(`/consultations/${enc(ctx.consultationId)}`), {
    jar: ctx.people.professional.jar,
  });
  const body = safeJson(res.text);
  if (res.status !== 200 || !body || !body.body || body.body.note !== ctx.consultationNote) {
    throw new SmokeFailure(`the consultation record was not read back (HTTP ${res.status}, ${errorCode(res.text)})`);
  }
  return `consultation record ${ctx.consultationId} read back, note matches`;
}

// Step 7. The auditor reads the audit log. In write mode, the entries of this run must be there.
async function readAudit(ctx) {
  const query = new URLSearchParams({ limit: '200' });
  if (!ctx.readOnly) {
    query.set('actorId', ctx.people.professional.id);
  }
  const res = await send(ctx.api(`/audit?${query}`), { jar: ctx.people.auditor.jar });
  const body = safeJson(res.text);
  if (res.status !== 200 || !body || !Array.isArray(body.items)) {
    throw new SmokeFailure(`the audit log was not read (HTTP ${res.status}, ${errorCode(res.text)})`);
  }
  if (ctx.readOnly) {
    return `audit log read as auditor, ${body.items.length} entries`;
  }

  const has = (action, targetId) => body.items.some((entry) => entry.action === action && entry.targetId === targetId);
  const expected = [];
  if (ctx.appointmentId) expected.push(['appointment.create', ctx.appointmentId, 'appointment']);
  if (ctx.meetingProvider) expected.push([`meeting.create_${ctx.meetingProvider}`, ctx.appointmentId, 'meeting']);
  if (ctx.consultationId) expected.push(['consultation.create', ctx.consultationId, 'consultation']);
  const missing = expected.filter(([action, target]) => !has(action, target)).map(([, , label]) => label);
  if (missing.length > 0) {
    throw new SmokeFailure(`the audit log has no entry for: ${missing.join(', ')}`);
  }
  return `audit log read as auditor, ${expected.length} entries of this run found`;
}

// `requires` lists the steps (1-based) that must pass first. `readOnlyRun` replaces
// `run` in read-only mode. `writeOnly` steps are skipped in read-only mode.
const STEPS = Object.freeze([
  { name: 'sign-in', requires: [], run: signInAll },
  { name: 'appointment', requires: [1], run: createAppointment, readOnlyRun: readAppointment },
  { name: 'video meeting', requires: [2], run: createMeeting, writeOnly: true },
  { name: 'chat', requires: [2], run: chatRoundTrip, writeOnly: true },
  { name: 'consultation create', requires: [2], run: createConsultation, writeOnly: true },
  { name: 'consultation read', requires: [5], run: readConsultation, writeOnly: true },
  { name: 'audit', requires: [1], run: readAudit },
]);

// A random tag for the records of one run. Every text the run writes starts with it.
function newRunTag() {
  return `smoke-${randomBytes(4).toString('hex')}`;
}

module.exports = { STEPS, newRunTag };
