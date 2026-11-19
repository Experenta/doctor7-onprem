'use strict';

const { VideoProviderError, assertVideoProvider } = require('./provider');

// Chooses the provider and runs the failover. `selected` is the configured
// provider name. `providers` maps names to VideoProvider objects. With selected
// `meet`, a Meet failure creates the meeting in Jitsi. The decision is made per
// call, and nothing is remembered, so meetings that exist stay where they are
// and the next call tries Meet again.
function createMeetingService({ selected, providers }) {
  const meet = providers.meet ? assertVideoProvider(providers.meet) : null;
  const jitsi = providers.jitsi ? assertVideoProvider(providers.jitsi) : null;
  if (selected !== 'meet' && selected !== 'jitsi') {
    throw new TypeError('selected must be meet or jitsi.');
  }
  if (!jitsi || (selected === 'meet' && !meet)) {
    throw new TypeError('The selected provider and the Jitsi failover target are required.');
  }

  // `onFailover(kind)` runs before the Jitsi meeting is created. When it throws,
  // the creation stops and no meeting is made.
  // Returns { provider, url }.
  async function create(appointment, { onFailover } = {}) {
    if (selected === 'meet') {
      try {
        const { url } = await meet.createMeeting({ appointment });
        return { provider: 'meet', url };
      } catch (err) {
        if (!(err instanceof VideoProviderError)) throw err;
        if (onFailover) await onFailover(err.kind);
      }
    }
    const { url } = await jitsi.createMeeting({ appointment });
    return { provider: 'jitsi', url };
  }

  return { selected, create };
}

module.exports = { createMeetingService };
