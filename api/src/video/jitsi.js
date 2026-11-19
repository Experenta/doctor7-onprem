'use strict';

const crypto = require('node:crypto');
const { VideoProviderError } = require('./provider');

const ROOM_PREFIX = 'doctor7-';
const ROOM_RANDOM_BYTES = 16;
const TOKEN_GRACE_SECONDS = 3600;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// HS256 token for one room, in the form Jitsi's token authentication expects.
function signRoomToken({ appId, secret, host, room, issuedAt, expiresAt }) {
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: appId,
    aud: appId,
    sub: host,
    room,
    iat: issuedAt,
    exp: expiresAt,
  })}`;
  const signature = crypto.createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

// Jitsi adapter. `config` is the `jitsi` part of loadVideoConfig. The room name
// is random, so the address cannot be guessed. With an app id and a secret, the
// address also carries a token that expires one hour after the appointment ends.
function createJitsiProvider({ config, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  const base = new URL(config.baseUrl);
  const signed = Boolean(config.appId && config.jwtSecret);

  return {
    name: 'jitsi',

    async createMeeting({ appointment }) {
      try {
        const room = `${ROOM_PREFIX}${randomBytes(ROOM_RANDOM_BYTES).toString('hex')}`;
        const url = new URL(base.href);
        url.pathname = `${base.pathname.replace(/\/+$/, '')}/${room}`;
        if (signed) {
          const issuedAt = Math.floor(now().getTime() / 1000);
          const endsAt = Math.floor(appointment.endsAt.getTime() / 1000);
          url.searchParams.set(
            'jwt',
            signRoomToken({
              appId: config.appId,
              secret: config.jwtSecret,
              host: base.hostname,
              room,
              issuedAt,
              expiresAt: Math.max(endsAt, issuedAt) + TOKEN_GRACE_SECONDS,
            })
          );
        }
        return { url: url.href };
      } catch {
        throw new VideoProviderError('error');
      }
    },
  };
}

module.exports = { createJitsiProvider, ROOM_PREFIX };
