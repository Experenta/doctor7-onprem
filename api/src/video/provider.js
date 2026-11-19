'use strict';

// The VideoProvider interface. An adapter is an object with:
//
//   name: 'meet' | 'jitsi'
//   createMeeting({ appointment }) -> Promise<{ url }>
//
// `appointment` has at least { id, startsAt, endsAt }. createMeeting throws a
// VideoProviderError for every failure, so the caller never has to read a driver
// or upstream message. Changing the call to a provider means changing its adapter
// only.

const PROVIDER_NAMES = Object.freeze(['meet', 'jitsi']);
const FAILURE_KINDS = Object.freeze(['error', 'timeout', 'quota']);

const MESSAGES = Object.freeze({
  error: 'The video provider could not create the meeting.',
  timeout: 'The video provider did not answer in time.',
  quota: 'The video provider refused the request because of its quota.',
});

// The message is fixed on purpose. It never holds text from the provider, a
// credential, or a request body.
class VideoProviderError extends Error {
  constructor(kind) {
    const safeKind = FAILURE_KINDS.includes(kind) ? kind : 'error';
    super(MESSAGES[safeKind]);
    this.name = 'VideoProviderError';
    this.kind = safeKind;
  }
}

function assertVideoProvider(provider) {
  if (
    !provider ||
    !PROVIDER_NAMES.includes(provider.name) ||
    typeof provider.createMeeting !== 'function'
  ) {
    throw new TypeError('A VideoProvider needs a name (meet or jitsi) and a createMeeting function.');
  }
  return provider;
}

module.exports = { PROVIDER_NAMES, FAILURE_KINDS, VideoProviderError, assertVideoProvider };
