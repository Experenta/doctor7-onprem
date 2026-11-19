'use strict';

const { createSqlCareStore } = require('./store');
const { createCareRouter } = require('./router');

// Builds the appointment and consultation router. `store`, `now`, `newId`, and
// `audit` can be replaced, which tests do. `audit` is required.
function createCare({ db, store, now, newId, audit }) {
  return { router: createCareRouter({ store: store || createSqlCareStore(db), now, newId, audit }) };
}

module.exports = { createCare };
