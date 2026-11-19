'use strict';

const { createSqlCareStore } = require('./store');
const { createCareRouter } = require('./router');

// Builds the appointment and consultation router. `store`, `now`, and `newId`
// can be replaced, which tests do.
function createCare({ db, store, now, newId }) {
  return { router: createCareRouter({ store: store || createSqlCareStore(db), now, newId }) };
}

module.exports = { createCare };
