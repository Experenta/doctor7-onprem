'use strict';

const { createSqlCareStore } = require('../care/store');
const { createJitsiProvider } = require('./jitsi');
const { createMeetProvider } = require('./meet');
const { createMeetingService } = require('./service');
const { createVideoRouter } = require('./router');
const { createSqlMeetingStore } = require('./store');
const { loadVideoConfig } = require('./config');

// Builds the meeting router from a loaded video config (see config.js). With no
// provider configured, a POST answers 503 unless the meeting already exists. `store`
// replaces the SQL care store, `meetingStore` replaces the SQL meeting store, and
// `audit` is required. `now` and `fetchImpl` can be replaced in tests. `demoMode` is true only
// when the API runs with DEMO_MODE=1: the answer then marks a Meet meeting as simulated.
function createVideo({ db, store, meetingStore, audit, config, logger, now, fetchImpl, demoMode = false }) {
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
  return {
    router: createVideoRouter({
      store: store || createSqlCareStore(db),
      meetings: meetingStore || createSqlMeetingStore(db),
      audit,
      service,
      logger,
      now,
      demoMode,
    }),
  };
}

module.exports = { createVideo, loadVideoConfig };
