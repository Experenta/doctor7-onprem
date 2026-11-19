'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { OidcError } = require('./oidc');
const { parseCookies, serializeCookie, clearCookie } = require('./cookies');
const { randomToken, sha256Hex, pkceChallenge, safeEqual } = require('./tokens');
const { discardingAudit } = require('../audit/entry');
const { check, validateRequest } = require('../security/validate');
const { callbackQuery, noQuery, logoutBody } = require('../security/schemas');

const LOGIN_COOKIE = 'd7_login';
const LOGIN_PATH = '/auth';
const LOGIN_ATTEMPT_TTL_SECONDS = 10 * 60;
const CODE_MAX_LENGTH = 2048;

// Logs a fixed event and reason code. Tokens, codes, emails, and cookie values
// are never passed here.
function logEvent(logger, event, reason) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(`auth ${event}: ${reason}`);
  }
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

// `audit` receives one entry for each sign-in outcome, each logout, and each
// refused sign-in. The entries carry reason codes, never tokens or emails.
function createAuthRouter({
  config,
  store,
  sessions,
  oidc,
  logger = console,
  now = () => new Date(),
  audit = discardingAudit,
}) {
  const router = Router();

  function sessionCookie(token, expiresAt) {
    return serializeCookie(config.sessionCookieName, token, {
      maxAgeSeconds: (expiresAt.getTime() - now().getTime()) / 1000,
      sameSite: 'Strict',
    });
  }

  const clearedSession = () => clearCookie(config.sessionCookieName, { sameSite: 'Strict' });
  const clearedLogin = () => clearCookie(LOGIN_COOKIE, { sameSite: 'Lax', path: LOGIN_PATH });

  function providerError(err) {
    if (err instanceof OidcError) {
      logEvent(logger, 'provider', err.reason);
      if (err.unavailable) {
        return new ApiError(502, 'identity_provider_unavailable', 'The identity provider is not available.');
      }
    }
    return err;
  }

  // Records a refused sign-in and returns the error for the caller to throw.
  // The actor is unknown at this point, so the entry has no actor and no center.
  async function rejected(req, reason, error) {
    await audit.record({
      actorId: null,
      centerId: null,
      ip: req.ip,
      action: 'auth.login',
      targetType: 'user',
      outcome: 'failure',
      reason,
    });
    return error;
  }

  async function loginFailed(req, reason) {
    logEvent(logger, 'login_failed', reason);
    return rejected(req, reason, new ApiError(401, 'login_failed', 'Sign-in failed.'));
  }

  // GET /auth/login: start the authorization code flow with PKCE.
  router.get('/auth/login', validateRequest({ query: noQuery }), async (req, res) => {
    noStore(res);
    const at = now();
    try {
      await store.purgeExpired(at);
    } catch (err) {
      // Cleanup is best effort and must not block sign-in.
      logger.error(err);
    }

    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    const binding = randomToken();

    let location;
    try {
      location = await oidc.authorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
      });
    } catch (err) {
      throw providerError(err);
    }

    await store.createLoginAttempt({
      stateHash: sha256Hex(state),
      bindingHash: sha256Hex(binding),
      nonce,
      codeVerifier,
      createdAt: at,
      expiresAt: new Date(at.getTime() + LOGIN_ATTEMPT_TTL_SECONDS * 1000),
    });

    // The binding cookie ties the callback to this browser. It is Lax because the
    // callback is a cross-site navigation from the identity provider.
    res.append(
      'Set-Cookie',
      serializeCookie(LOGIN_COOKIE, binding, {
        maxAgeSeconds: LOGIN_ATTEMPT_TTL_SECONDS,
        sameSite: 'Lax',
        path: LOGIN_PATH,
      })
    );
    res.redirect(302, location);
  });

  // GET /auth/callback: finish the flow and open a session.
  router.get('/auth/callback', async (req, res) => {
    noStore(res);
    res.append('Set-Cookie', clearedLogin());

    const checked = check(callbackQuery, req.query, 'query');
    if (!checked.ok) {
      throw await rejected(req, 'invalid_request', new ApiError(400, 'invalid_login_request', 'The sign-in request is not valid.'));
    }
    const { state, code, error } = checked.value;

    // The attempt is deleted by this read, so a state value works once.
    const attempt = await store.consumeLoginAttempt(sha256Hex(state));
    if (!attempt) {
      logEvent(logger, 'callback_rejected', 'state_unknown');
      throw await rejected(req, 'state_unknown', new ApiError(400, 'invalid_login_request', 'The sign-in request is not valid.'));
    }
    if (attempt.expiresAt <= now()) {
      logEvent(logger, 'callback_rejected', 'attempt_expired');
      throw await rejected(req, 'attempt_expired', new ApiError(400, 'invalid_login_request', 'The sign-in request is not valid.'));
    }
    const binding = parseCookies(req.headers.cookie)[LOGIN_COOKIE];
    if (!binding || !safeEqual(sha256Hex(binding), attempt.bindingHash)) {
      logEvent(logger, 'callback_rejected', 'binding_mismatch');
      throw await rejected(req, 'binding_mismatch', new ApiError(400, 'invalid_login_request', 'The sign-in request is not valid.'));
    }

    if (error !== undefined) {
      throw await loginFailed(req, 'provider_returned_error');
    }
    if (typeof code !== 'string' || code.length === 0 || code.length > CODE_MAX_LENGTH) {
      throw await rejected(req, 'invalid_request', new ApiError(400, 'invalid_login_request', 'The sign-in request is not valid.'));
    }

    let identity;
    try {
      const idToken = await oidc.exchangeCode({ code, codeVerifier: attempt.codeVerifier });
      identity = await oidc.verifyIdToken(idToken, { nonce: attempt.nonce });
    } catch (err) {
      if (!(err instanceof OidcError)) {
        throw err;
      }
      logEvent(logger, 'provider', err.reason);
      if (err.unavailable) {
        throw await rejected(
          req,
          err.reason,
          new ApiError(502, 'identity_provider_unavailable', 'The identity provider is not available.')
        );
      }
      throw await loginFailed(req, err.reason);
    }

    // Role and center come from the users table, matched on the verified email.
    const user = await store.findUserByEmail(identity.email);
    if (!user) {
      logEvent(logger, 'login_denied', 'user_not_found');
      await audit.record({
        actorId: null,
        centerId: null,
        ip: req.ip,
        action: 'auth.login',
        targetType: 'user',
        outcome: 'denied',
        reason: 'user_not_found',
      });
      throw new ApiError(403, 'access_denied', 'This account is not authorized for this system.');
    }

    const session = await sessions.create(user);
    await audit.record({
      actorId: user.id,
      centerId: user.centerId,
      ip: req.ip,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
    });
    res.append('Set-Cookie', sessionCookie(session.token, session.expiresAt));
    res.redirect(302, config.postLoginPath);
  });

  // GET /auth/me: the signed-in user.
  router.get('/auth/me', validateRequest({ query: noQuery }), async (req, res) => {
    noStore(res);
    const token = parseCookies(req.headers.cookie)[config.sessionCookieName];
    const auth = await sessions.authenticate(token);
    if (!auth) {
      throw new ApiError(401, 'unauthenticated', 'Sign-in is required.');
    }
    res.json({
      user: auth.user,
      session: {
        expiresAt: auth.session.expiresAt.toISOString(),
        idleExpiresAt: auth.session.idleExpiresAt.toISOString(),
      },
    });
  });

  // POST /auth/logout: revoke this session, or every session of the user when
  // the body is {"all":true}. It always answers 204 and clears the cookie. Each
  // call writes one audit entry. It is a failure with reason no_session when the
  // cookie names no live session.
  router.post('/auth/logout', validateRequest({ query: noQuery, body: logoutBody }), async (req, res) => {
    noStore(res);
    const token = parseCookies(req.headers.cookie)[config.sessionCookieName];
    const wantsAll = req.valid.body.all === true;
    const auth = await sessions.authenticate(token);
    if (auth && wantsAll) {
      await sessions.revokeAllForUser(auth.user.id);
    } else {
      await sessions.revoke(token);
    }
    await audit.record({
      actorId: auth ? auth.user.id : null,
      centerId: auth ? auth.user.centerId : null,
      ip: req.ip,
      action: wantsAll ? 'auth.logout_all' : 'auth.logout',
      targetType: 'session',
      outcome: auth ? 'success' : 'failure',
      reason: auth ? null : 'no_session',
    });
    res.append('Set-Cookie', clearedSession());
    res.status(204).end();
  });

  return router;
}

// Middleware for routes that need a signed-in user. Optional `roles` limits
// access to those roles. It sets req.auth = { user, session }.
function createRequireSession({ config, sessions }) {
  return function requireSession(...roles) {
    return async (req, res, next) => {
      try {
        const token = parseCookies(req.headers.cookie)[config.sessionCookieName];
        const auth = await sessions.authenticate(token);
        if (!auth) {
          throw new ApiError(401, 'unauthenticated', 'Sign-in is required.');
        }
        // req.auth is set before the role check, so a 403 can name its actor in the audit log.
        req.auth = auth;
        if (roles.length > 0 && !roles.includes(auth.user.role)) {
          throw new ApiError(403, 'forbidden', 'This account may not use this resource.');
        }
        next();
      } catch (err) {
        next(err);
      }
    };
  };
}

module.exports = { createAuthRouter, createRequireSession, LOGIN_COOKIE };
