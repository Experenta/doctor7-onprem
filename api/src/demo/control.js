'use strict';

// Client of the Google simulator control endpoint (K-36). It talks to loopback only, with
// the shared demo secret. Every failure becomes a DemoControlError with a fixed message, so
// nothing from the simulator and no secret reaches a response, a log, or an audit entry.

const CONTROL_PATH = '/control/mode';
const OUTAGE_MODE = 'http_500';
const NORMAL_MODE = 'ok';

class DemoControlError extends Error {
  constructor() {
    super('The Google Meet simulator did not answer.');
    this.name = 'DemoControlError';
  }
}

// `config` comes from loadDemoConfig. `fetchImpl` can be replaced in tests.
function createMeetControl({ config, fetchImpl = fetch }) {
  if (!config) {
    throw new TypeError('createMeetControl requires a demo config.');
  }

  async function call(method, body) {
    let response;
    try {
      response = await fetchImpl(`${config.controlUrl}${CONTROL_PATH}`, {
        method,
        headers: {
          'x-demo-control-secret': config.controlSecret,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new DemoControlError();
    }
    if (!response.ok) throw new DemoControlError();
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload.mode !== 'string') throw new DemoControlError();
    return payload.mode !== NORMAL_MODE;
  }

  return {
    // True while the simulator is in any mode but `ok`.
    getOutage: () => call('GET'),
    // Sets the outage on or off and returns the state the simulator reports.
    setOutage: (on) => call('POST', { mode: on ? OUTAGE_MODE : NORMAL_MODE }),
  };
}

module.exports = { createMeetControl, DemoControlError };
