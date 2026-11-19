'use strict';

const fs = require('node:fs');
const { Router } = require('express');
const { ApiError } = require('./errors');
const { version } = require('../../package.json');

// Liveness never touches the database. Readiness fails when the database
// cannot answer a trivial query. Version reports the package version and the
// build date only. Nothing else about the server is returned.

// The package writes this file at build time: version=<...> and build-date=<...>.
const DEFAULT_VERSION_FILE = '/usr/lib/doctor7/VERSION';

// An ISO 8601 UTC instant, with an optional fraction of up to three digits.
const BUILD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// A build date normalized to milliseconds. Any other value is null.
function normalizeBuildDate(raw) {
  if (typeof raw !== 'string' || !BUILD_DATE_PATTERN.test(raw)) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// The build date from BUILD_DATE, normalized to milliseconds. Any other value is null.
function readBuildDate(env = process.env) {
  return normalizeBuildDate(env.BUILD_DATE);
}

// Reads the lines of the version file. Returns null when the version line is
// missing or empty. A file without a build-date line has a null build date.
function parseVersionFile(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z-]+)=(.*)$/.exec(line.trim());
    if (match && !values.has(match[1])) {
      values.set(match[1], match[2]);
    }
  }
  const fileVersion = values.get('version');
  if (!fileVersion) {
    return null;
  }
  return { version: fileVersion, buildDate: normalizeBuildDate(values.get('build-date')) };
}

// The build information for GET /version. When the version file exists and is
// valid, it is the source. Otherwise the version comes from package.json and the
// build date from BUILD_DATE. A file that cannot be read or has no version line
// is logged once, and the fallback applies. The API still starts.
function readBuildInfo({ env = process.env, logger = console } = {}) {
  const file = env.D7_VERSION_FILE || DEFAULT_VERSION_FILE;
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.error(`doctor7: cannot read the version file ${file} (${err.code}). Using package.json.`);
    }
  }
  if (text !== null) {
    const fromFile = parseVersionFile(text);
    if (fromFile) {
      return fromFile;
    }
    logger.error(`doctor7: the version file ${file} has no version line. Using package.json.`);
  }
  return { version, buildDate: readBuildDate(env) };
}

function createHealthRouter({ db, logger = console, build = readBuildInfo({ logger }) }) {
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

module.exports = { createHealthRouter, readBuildDate, readBuildInfo, parseVersionFile, DEFAULT_VERSION_FILE };
