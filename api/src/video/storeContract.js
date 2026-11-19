'use strict';

// One battery of tests for the meeting store contract (see store.js). The file name
// does not end in .test.js, so the runner does not execute it. store.test.js runs it
// against the in-memory store and, with DATABASE_URL, against the SQL store.
//
// `make()` returns:
//   store                        the store under test
//   newAppointment()             creates an appointment and returns its id
//   deleteAppointment(id)        deletes it, the way the database does
//   cleanup()                    removes whatever the test created
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { DuplicateMeetingError } = require('./store');

const CREATED_AT = new Date('2026-12-01T15:00:00.123Z');

function runMeetingStoreContract(name, make, { skip = false } = {}) {
  describe(name, { skip }, () => {
    async function withStore(fn) {
      const fixture = await make();
      try {
        await fn(fixture);
      } finally {
        await fixture.cleanup();
      }
    }

    const meetingFor = (appointmentId, overrides = {}) => ({
      appointmentId,
      provider: 'jitsi',
      url: 'https://jitsi.example.test/doctor7-room?jwt=token-1',
      createdBy: 'u-pro1',
      createdAt: CREATED_AT,
      ...overrides,
    });

    test('a created meeting is read back with every field', () =>
      withStore(async ({ store, newAppointment }) => {
        const id = await newAppointment();
        const stored = await store.insertMeeting(meetingFor(id));
        assert.deepEqual(stored, meetingFor(id));
        const read = await store.findMeeting(id);
        assert.deepEqual(read, meetingFor(id));
        assert.ok(read.createdAt instanceof Date);
        assert.equal(read.createdAt.getTime(), CREATED_AT.getTime());
      }));

    test('an appointment without a meeting reads as null', () =>
      withStore(async ({ store, newAppointment }) => {
        assert.equal(await store.findMeeting(await newAppointment()), null);
      }));

    test('a second meeting for the same appointment is refused and the first one stays', () =>
      withStore(async ({ store, newAppointment }) => {
        const id = await newAppointment();
        await store.insertMeeting(meetingFor(id));
        await assert.rejects(
          store.insertMeeting(meetingFor(id, { provider: 'meet', url: 'https://meet.google.com/abc-defg-hij', createdBy: 'u-pro2' })),
          DuplicateMeetingError
        );
        assert.deepEqual(await store.findMeeting(id), meetingFor(id));
      }));

    test('two meetings for different appointments do not collide', () =>
      withStore(async ({ store, newAppointment }) => {
        const first = await newAppointment();
        const second = await newAppointment();
        await store.insertMeeting(meetingFor(first, { url: 'https://jitsi.example.test/one' }));
        await store.insertMeeting(meetingFor(second, { url: 'https://jitsi.example.test/two' }));
        assert.equal((await store.findMeeting(first)).url, 'https://jitsi.example.test/one');
        assert.equal((await store.findMeeting(second)).url, 'https://jitsi.example.test/two');
      }));

    test('a long signed address is stored whole', () =>
      withStore(async ({ store, newAppointment }) => {
        const id = await newAppointment();
        const url = `https://jitsi.example.test/room?jwt=${'a'.repeat(3000)}`;
        await store.insertMeeting(meetingFor(id, { url }));
        assert.equal((await store.findMeeting(id)).url, url);
      }));

    test('deleting the appointment deletes its meeting', () =>
      withStore(async ({ store, newAppointment, deleteAppointment }) => {
        const id = await newAppointment();
        await store.insertMeeting(meetingFor(id));
        await deleteAppointment(id);
        assert.equal(await store.findMeeting(id), null);
      }));
  });
}

module.exports = { runMeetingStoreContract };
