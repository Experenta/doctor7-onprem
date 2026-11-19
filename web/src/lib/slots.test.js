import { describe, expect, it } from 'vitest';
import { addMinutes, durationMinutes, formatClock } from './slots.js';

describe('durationMinutes', () => {
  it('counts the minutes between two times of the same day', () => {
    expect(durationMinutes('10:00', '10:50')).toBe(50);
    expect(durationMinutes('09:30', '11:00')).toBe(90);
    expect(durationMinutes('00:00', '23:59')).toBe(1439);
  });

  it('is null when a time is missing, invalid, or the end is not after the start', () => {
    expect(durationMinutes('', '10:50')).toBeNull();
    expect(durationMinutes('10:00', '')).toBeNull();
    expect(durationMinutes('10:00', '10:00')).toBeNull();
    expect(durationMinutes('10:00', '09:00')).toBeNull();
    expect(durationMinutes('25:00', '26:00')).toBeNull();
    expect(durationMinutes('10:7', '11:00')).toBeNull();
  });
});

describe('addMinutes', () => {
  it('adds minutes and keeps two digits', () => {
    expect(addMinutes('10:00', 50)).toBe('10:50');
    expect(addMinutes('09:15', 45)).toBe('10:00');
    expect(addMinutes('00:00', 30)).toBe('00:30');
    expect(addMinutes('22:30', 89)).toBe('23:59');
  });

  it('is null when the result is past midnight, or the input is not usable', () => {
    expect(addMinutes('23:30', 30)).toBeNull();
    expect(addMinutes('23:30', 90)).toBeNull();
    expect(addMinutes('', 30)).toBeNull();
    expect(addMinutes('10:00', 0)).toBeNull();
    expect(addMinutes('10:00', -5)).toBeNull();
    expect(addMinutes('10:00', 1.5)).toBeNull();
  });
});

describe('formatClock', () => {
  it('writes a 12-hour clock with AM and PM', () => {
    expect(formatClock('00:05')).toBe('12:05 AM');
    expect(formatClock('09:00')).toBe('9:00 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
    expect(formatClock('15:45')).toBe('3:45 PM');
    expect(formatClock('23:59')).toBe('11:59 PM');
  });

  it('gives an empty string for an empty or invalid time', () => {
    expect(formatClock('')).toBe('');
    expect(formatClock('99:00')).toBe('');
    expect(formatClock(undefined)).toBe('');
  });
});
