import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials.js';
import {
  addDays,
  countdownText,
  dayHeading,
  dayKey,
  dayNumber,
  formatDayKey,
  formatToday,
  formatWeekRange,
  groupByDay,
  matchesFilter,
  onDay,
  weekDays,
  weekdayShort,
  weekStart,
} from './schedule.js';

describe('Bogota days', () => {
  it('gives the Bogota calendar day of an instant', () => {
    expect(dayKey('2026-12-02T05:00:00.000Z')).toBe('2026-12-02');
    expect(dayKey('2026-12-02T04:59:00.000Z')).toBe('2026-12-01');
    expect(dayKey(Date.parse('2026-12-02T15:00:00.000Z'))).toBe('2026-12-02');
    expect(dayKey('not a date')).toBeNull();
  });

  it('adds days across a month and a year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds the Monday of a week, and seven days from it', () => {
    expect(weekStart('2026-12-02')).toBe('2026-11-30');
    expect(weekStart('2026-11-30')).toBe('2026-11-30');
    expect(weekStart('2026-12-06')).toBe('2026-11-30');
    expect(weekDays('2026-12-02')).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
  });

  it('writes day labels', () => {
    expect(formatDayKey('2026-12-02')).toBe('Wednesday, Dec 2');
    expect(weekdayShort('2026-12-02')).toBe('Wed');
    expect(dayNumber('2026-12-02')).toBe(2);
    expect(dayHeading('2026-12-02', '2026-12-02')).toBe('Today');
    expect(dayHeading('2026-12-03', '2026-12-02')).toBe('Tomorrow');
    expect(dayHeading('2026-12-01', '2026-12-02')).toBe('Yesterday');
    expect(dayHeading('2026-11-28', '2026-12-02')).toBe('Saturday, Nov 28');
    expect(formatWeekRange(weekDays('2026-12-02'))).toBe('Nov 30 to Dec 6');
  });

  it('writes the header date in Bogota time', () => {
    expect(formatToday(Date.parse('2026-11-19T03:00:00.000Z'))).toBe('Wednesday, Nov 18');
    expect(formatToday(Date.parse('2026-11-19T05:00:00.000Z'))).toBe('Thursday, Nov 19');
  });
});

describe('grouping by day', () => {
  const at = (id, iso, status = 'scheduled') => ({ id, startsAt: iso, endsAt: iso, status });
  const now = Date.parse('2026-12-02T15:00:00.000Z');

  it('puts today and later first, then earlier days with the newest first', () => {
    const groups = groupByDay(
      [
        at('past-1', '2026-12-01T15:00:00.000Z'),
        at('today-late', '2026-12-02T20:00:00.000Z'),
        at('next', '2026-12-03T15:00:00.000Z'),
        at('past-old', '2026-11-28T15:00:00.000Z'),
        at('today-early', '2026-12-02T14:00:00.000Z'),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Tomorrow', 'Yesterday', 'Saturday, Nov 28']);
    expect(groups.map((group) => group.section)).toEqual(['upcoming', 'upcoming', 'earlier', 'earlier']);
    expect(groups[0].items.map((item) => item.id)).toEqual(['today-early', 'today-late']);
  });

  it('keeps an appointment with a bad date in its own last group', () => {
    const groups = groupByDay([at('bad', 'nope'), at('ok', '2026-12-03T15:00:00.000Z')], now);
    expect(groups.map((group) => group.label)).toEqual(['Tomorrow', 'Unknown date']);
  });

  it('returns no group for no appointment', () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it('lists the appointments of one day by start time', () => {
    const list = [at('b', '2026-12-02T16:00:00.000Z'), at('a', '2026-12-02T15:00:00.000Z'), at('c', '2026-12-03T15:00:00.000Z')];
    expect(onDay(list, '2026-12-02').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('filters by status', () => {
    expect(matchesFilter({ status: 'scheduled' }, 'scheduled')).toBe(true);
    expect(matchesFilter({ status: 'completed' }, 'scheduled')).toBe(false);
    expect(matchesFilter({ status: 'completed' }, 'closed')).toBe(true);
    expect(matchesFilter({ status: 'cancelled' }, 'closed')).toBe(true);
    expect(matchesFilter({ status: 'scheduled' }, 'closed')).toBe(false);
    expect(matchesFilter({ status: 'cancelled' }, 'all')).toBe(true);
  });
});

describe('countdown', () => {
  const minute = 60 * 1000;
  it('says how long is left in the unit that fits', () => {
    expect(countdownText(0)).toBe('Starting now');
    expect(countdownText(-5 * minute)).toBe('Starting now');
    expect(countdownText(30 * 1000)).toBe('Starts in less than a minute');
    expect(countdownText(25 * minute)).toBe('Starts in 25 min');
    expect(countdownText(190 * minute)).toBe('Starts in 3 h 10 min');
    expect(countdownText(120 * minute)).toBe('Starts in 2 h');
    expect(countdownText(36 * 60 * minute)).toBe('Starts in 1 day');
    expect(countdownText(72 * 60 * minute)).toBe('Starts in 3 days');
  });
});

describe('initials', () => {
  it('uses the first and last word of a name', () => {
    expect(initialsOf('Ana Rivera')).toBe('AR');
    expect(initialsOf('Rosa Admin')).toBe('RA');
    expect(initialsOf('Maria de la Cruz')).toBe('MC');
  });

  it('skips the one-letter prefix of an ID', () => {
    expect(initialsOf('u-luis')).toBe('LU');
    expect(initialsOf('u-ana')).toBe('AN');
  });

  it('never returns an empty value', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('x')).toBe('X');
    expect(initialsOf('u')).toBe('U');
  });
});
