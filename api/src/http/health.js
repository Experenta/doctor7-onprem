'use strict';

const { Router } = require('express');
const { ApiError } = require('./errors');
const { version } = require('../../package.json');

// Liveness never touches the database. Readiness fails when the database
// cannot answer a trivial query. Version reports the API version and the build
// date only. Nothing else about the server is returned.

// An ISO 8601 UTC instant, with an optional fraction of up to three digits.
const BUILD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// The build date from BUILD_DATE, normalized to milliseconds. Any other value is null.
function readBuildDate(env = process.env) {
  const raw = env.BUILD_DATE;
  if (typeof raw !== 'string' || !BUILD_DATE_PATTERN.test(raw)) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function createHealthRouter({ db, logger = console, build = { version, buildDate: readBuildDate() } }) {
  const router = Router();

  router.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/readyz', async (req, res, next) => {
    try {
      await db.ping();
    } catch (err) {
      logger.error(err);
      next(new ApiError(503, 'database_unavailable', 'Database is not reachable.'));
      return;
    }
    res.json({ status: 'ready' });
  });

  router.get('/version', (req, res) => {
    res.json({ version: build.version, buildDate: build.buildDate });
  });

  return router;
}

module.exports = { createHealthRouter, readBuildDate };
