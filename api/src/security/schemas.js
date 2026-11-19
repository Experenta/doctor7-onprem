'use strict';

const v = require('./validate');
const { OUTCOMES } = require('../audit/entry');

// One schema for each input of each route. The routers connect them.

const PAGE_FIELDS = {
  limit: v.optional(v.integerText({ min: 1, max: 200 })),
  offset: v.optional(v.integerText({ min: 0, max: 999999999 })),
};

const idSchema = v.id();

// Routes that take no query string or no body.
const noQuery = v.object({});
const emptyBody = v.object({}, { allowMissing: true });

const pageQuery = v.object(PAGE_FIELDS);

const appointmentCreateBody = v.object({
  professionalId: v.id(),
  clientId: v.id(),
  startsAt: v.timestamp(),
  endsAt: v.timestamp(),
});

const consultationCreateBody = v.object({
  appointmentId: v.id(),
  body: v.jsonObject(),
});

const auditQuery = v.object({
  ...PAGE_FIELDS,
  from: v.optional(v.timestamp()),
  to: v.optional(v.timestamp()),
  actorId: v.optional(v.id()),
  action: v.optional(
    v.string({ max: 100, pattern: /^[a-z][a-z0-9_.]{0,99}$/, expect: 'must be a lowercase dotted name such as auth.login' })
  ),
  outcome: v.optional(v.oneOf(OUTCOMES)),
});

const logoutBody = v.object({ all: v.optional(v.boolean()) }, { allowMissing: true });

// The identity provider adds some of these (RFC 9207 `iss`, and the error
// fields). Any other key is refused.
const callbackQuery = v.object({
  state: v.string({ max: 128, pattern: /^[A-Za-z0-9_-]{20,128}$/ }),
  code: v.optional(v.string({ min: 0, max: 2048 })),
  error: v.optional(v.string({ min: 0, max: 200 })),
  error_description: v.optional(v.string({ min: 0, max: 1000 })),
  error_uri: v.optional(v.string({ min: 0, max: 2000 })),
  iss: v.optional(v.string({ min: 0, max: 2000 })),
  session_state: v.optional(v.string({ min: 0, max: 500 })),
});

module.exports = {
  idSchema,
  noQuery,
  emptyBody,
  pageQuery,
  appointmentCreateBody,
  consultationCreateBody,
  auditQuery,
  logoutBody,
  callbackQuery,
};
