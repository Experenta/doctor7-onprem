import { describe, expect, it } from 'vitest';
import { bogotaToUtcIso, formatDateTime, formatTime } from './format.js';
import { canAccess, navItemsFor, SCREEN_ROLES } from './access.js';
import { isInProgress, safeVideoUrl, upcomingAppointments } from './appointments.js';
import { friendlyMessage } from './errors.js';

describe('dates', () => {
  it('shows UTC instants in Bogota time', () => {
    expect(formatDateTime('2026-12-02T10:00:00.000Z')).toMatch(/^Dec 2, 2026, 5:00\sAM\sGMT-5$/);
    expect(formatTime('2026-12-02T03:30:00.000Z')).toMatch(/^10:30\sPM$/);
  });

  it('handles a day change between UTC and Bogota', () => {
    expect(formatDateTime('2026-12-02T02:00:00.000Z')).toMatch(/^Dec 1, 2026, 9:00\sPM/);
  });

  it('does not throw on bad input', () => {
    expect(formatDateTime('not a date')).toBe('Unknown date');
  });

  it('converts Bogota form input to UTC', () => {
    expect(bogotaToUtcIso('2026-12-02', '10:00')).toBe('2026-12-02T15:00:00.000Z');
    expect(bogotaToUtcIso('2026-12-02', '20:30')).toBe('2026-12-03T01:30:00.000Z');
    expect(bogotaToUtcIso('', '10:00')).toBeNull();
    expect(bogotaToUtcIso('2026-13-45', '10:00')).toBeNull();
  });
});

describe('role access', () => {
  it('lists the audit screen for the auditor only', () => {
    expect(SCREEN_ROLES.audit).toEqual(['auditor']);
    expect(canAccess('auditor', 'appointments')).toBe(false);
    expect(canAccess('client', 'newAppointment')).toBe(false);
    expect(canAccess('professional', 'newConsultation')).toBe(true);
    expect(canAccess('admin', 'newConsultation')).toBe(false);
    expect(canAccess('nobody', 'home')).toBe(false);
  });

  it('builds navigation from the same map', () => {
    const labels = (role) => navItemsFor(role).map((item) => item.label);
    expect(labels('professional')).toEqual(['Home', 'Appointments', 'New appointment']);
    expect(labels('client')).toEqual(['Home', 'Appointments']);
    expect(labels('admin')).toEqual(['Home', 'Appointments', 'New appointment']);
    expect(labels('auditor')).toEqual(['Home', 'Audit log']);
  });
});

describe('appointment helpers', () => {
  const base = { status: 'scheduled' };
  it('finds upcoming and in-progress appointments', () => {
    const now = Date.parse('2026-12-02T10:10:00.000Z');
    const running = { ...base, id: 1, startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:50:00.000Z' };
    const later = { ...base, id: 2, startsAt: '2026-12-05T10:00:00.000Z', endsAt: '2026-12-05T10:50:00.000Z' };
    const past = { ...base, id: 3, startsAt: '2026-11-01T10:00:00.000Z', endsAt: '2026-11-01T10:50:00.000Z' };
    const cancelled = { ...later, id: 4, status: 'cancelled' };
    expect(upcomingAppointments([later, past, cancelled, running], now).map((a) => a.id)).toEqual([1, 2]);
    expect(isInProgress(running, now)).toBe(true);
    expect(isInProgress(later, now)).toBe(false);
  });

  it('accepts only safe video addresses', () => {
    const secure = ['https', ''].join(':') + '//video.example.test/room';
    const loopback = ['http', ''].join(':') + '//127.0.0.1:8000/room';
    const remotePlain = ['http', ''].join(':') + '//video.example.test/room';
    expect(safeVideoUrl(secure)).toBe(secure);
    expect(safeVideoUrl(loopback)).toBe(loopback);
    expect(safeVideoUrl(remotePlain)).toBeNull();
    expect(safeVideoUrl('javascript:alert(1)')).toBeNull();
    expect(safeVideoUrl('')).toBeNull();
  });
});

describe('error messages', () => {
  it('say what happened and how to recover', () => {
    expect(friendlyMessage({ status: 0 })).toMatch(/Check your connection/);
    expect(friendlyMessage({ status: 404 })).toMatch(/Go back/);
    expect(friendlyMessage({ status: 500 })).toMatch(/Try again/);
    expect(friendlyMessage({ status: 400, message: 'Field is bad.' })).toBe('Field is bad. Check the fields and try again.');
  });
});
