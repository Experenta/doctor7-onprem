'use strict';

const { Router } = require('express');
const { ApiError } = require('./errors');

// Liveness never touches the database. Readiness fails when the database
// cannot answer a trivial query.
function createHealthRouter({ db, logger = console }) {
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

  return router;
}

module.exports = { createHealthRouter };
