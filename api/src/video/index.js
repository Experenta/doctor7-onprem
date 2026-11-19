'use strict';

const { createSqlCareStore } = require('../care/store');
const { createJitsiProvider } = require('./jitsi');
const { createMeetProvider } = require('./meet');
const { createMeetingService } = require('./service');
const { createVideoRouter } = require('./router');
const { loadVideoConfig } = require('./config');

// Builds the meeting router from a loaded video config (see config.js). With no
// provider configured, the route answers 503. `store` replaces the SQL care
// store and `audit` is required. `now` and `fetchImpl` can be replaced in tests.
function createVideo({ db, store, audit, config, logger, now, fetchImpl }) {
  if (!config) {
    throw new TypeError('createVideo requires a video config.');
  }
  let service = null;
  if (config.provider) {
    const providers = { jitsi: createJitsiProvider({ config: config.jitsi, now }) };
    if (config.provider === 'meet') {
      providers.meet = createMeetProvider({ config: config.meet, timeoutMs: config.timeoutMs, fetchImpl, now });
    }
    service = createMeetingService({ selected: config.provider, providers });
  }
  return { router: createVideoRouter({ store: store || createSqlCareStore(db), audit, service, logger }) };
}

module.exports = { createVideo, loadVideoConfig };
