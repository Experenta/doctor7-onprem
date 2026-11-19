import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appointment, ok, renderApp } from '../test/helpers.jsx';

// Wednesday, Dec 2, 2026, 10:00 in Bogota.
const NOW = '2026-12-02T15:00:00.000Z';

const at = (id, startsAt, status = 'scheduled', extra = {}) =>
  appointment({
    id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 50 * 60000).toISOString(),
    status,
    ...extra,
  });

const today = at('a-today', '2026-12-02T20:00:00.000Z');
const tomorrow = at('a-tomorrow', '2026-12-03T15:00:00.000Z');
const yesterday = at('a-yesterday', '2026-12-01T15:00:00.000Z', 'completed');
const old = at('a-old', '2026-11-20T15:00:00.000Z', 'cancelled');
const ITEMS = [old, tomorrow, today, yesterday];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

const open = (items = ITEMS, role = 'professional') =>
  renderApp('/appointments', { 'GET /appointments': ok({ items }) }, role);

const dayHeadings = (table) => [...table.querySelectorAll('th[scope="rowgroup"]')].map((cell) => cell.textContent);
const bodyRows = (table) => [...table.querySelectorAll('tr.appt-row')];

describe('Appointments list', () => {
  it('groups the rows by day, with today first and earlier days after a divider', async () => {
    open();
    const table = await screen.findByRole('table');
    expect(dayHeadings(table)).toEqual(['Today', 'Tomorrow', 'Earlier', 'Yesterday', 'Friday, Nov 20']);
    expect(bodyRows(table).map((row) => row.className)).toEqual([
      'appt-row appt-row-scheduled',
      'appt-row appt-row-scheduled',
      'appt-row appt-row-completed',
      'appt-row appt-row-cancelled',
    ]);
  });

  it('has the page header with the title, the date, and the action of the role', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeInTheDocument();
    expect(document.querySelector('.page-date')).toHaveTextContent('Wednesday, Dec 2');
    expect(screen.getAllByRole('link', { name: 'New appointment' })).toHaveLength(2);
  });

  it('shows initials, the time, the status, and a quick action in each row', async () => {
    open();
    const table = await screen.findByRole('table');
    const row = bodyRows(table)[0];
    expect(within(row).getByText('3:00 PM')).toBeInTheDocument();
    expect(within(row).getByText('AN')).toBeInTheDocument();
    expect(within(row).getByText('LU')).toBeInTheDocument();
    expect(within(row).getByText('u-ana')).toBeInTheDocument();
    expect(within(row).getByText('Scheduled')).toBeInTheDocument();
    const quick = within(row).getByRole('link', { name: /^Open the appointment at 3:00\sPM$/ });
    expect(quick).toHaveAttribute('href', '/appointments/a-today');
    expect(within(row).getByRole('link', { name: /Dec 2, 2026, 3:00\sPM\sGMT-5/ })).toHaveAttribute('href', '/appointments/a-today');
  });

  it('labels every cell, so the table can stack on a phone', async () => {
    open();
    const row = bodyRows(await screen.findByRole('table'))[0];
    expect([...row.querySelectorAll('td')].map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Starts',
      'Ends',
      'Status',
      'Professional',
      'Client',
      'Actions',
    ]);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Starts',
      'Ends',
      'Status',
      'Professional',
      'Client',
      'Actions',
    ]);
  });

  it('lets a client see the same list, without the creation link', async () => {
    open(ITEMS, 'client');
    const table = await screen.findByRole('table');
    expect(bodyRows(table)).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'New appointment' })).not.toBeInTheDocument();
  });

  it('holds 200 appointments and long IDs without a second table', async () => {
    const longId = `u-${'x'.repeat(90)}`;
    const many = Array.from({ length: 200 }, (_, index) =>
      at(`a-${index}`, new Date(Date.parse('2026-12-03T15:00:00.000Z') + index * 3600000).toISOString(), 'scheduled', { clientId: longId }),
    );
    open(many);
    const table = await screen.findByRole('table');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(bodyRows(table)).toHaveLength(200);
    expect(within(bodyRows(table)[0]).getByText(longId).closest('td')).toHaveClass('cell-break');
    expect(screen.getByRole('button', { name: /^All\s*200$/ })).toBeInTheDocument();
  });
});

describe('Appointments filters', () => {
  const chip = (name) => screen.getByRole('button', { name });

  it('counts each status on the chips, with All on at first', async () => {
    open();
    await screen.findByRole('table');
    expect(chip(/^All\s*4$/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Scheduled\s*2$/)).toHaveAttribute('aria-pressed', 'false');
    expect(chip(/^Closed\s*2$/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('shows only scheduled appointments, or only closed ones', async () => {
    open();
    const table = await screen.findByRole('table');
    await userEvent.click(chip(/^Scheduled/));
    expect(chip(/^Scheduled/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false');
    expect(bodyRows(table).map((row) => row.className)).toEqual(['appt-row appt-row-scheduled', 'appt-row appt-row-scheduled']);
    expect(dayHeadings(table)).toEqual(['Today', 'Tomorrow']);

    await userEvent.click(chip(/^Closed/));
    expect(bodyRows(table).map((row) => row.className)).toEqual(['appt-row appt-row-completed', 'appt-row appt-row-cancelled']);
    expect(dayHeadings(table)).toEqual(['Yesterday', 'Friday, Nov 20']);

    await userEvent.click(chip(/^All/));
    expect(bodyRows(table)).toHaveLength(4);
  });

  it('explains a filter with no result, and shows everything again on request', async () => {
    open([today, tomorrow]);
    await screen.findByRole('table');
    await userEvent.click(chip(/^Closed/));
    expect(screen.getByText('No appointments match this filter')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all appointments' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Appointments week view', () => {
  const week = async () => {
    open();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
  };
  const columns = () => [...document.querySelectorAll('.week-col')];

  it('starts on the list, and switches with one button on at a time', async () => {
    open();
    await screen.findByRole('table');
    const group = screen.getByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'Week' }));
    expect(within(group).getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows seven days from Monday, with today marked, and the appointments as links', async () => {
    await week();
    expect(screen.getByText('Nov 30 to Dec 6')).toBeInTheDocument();
    expect(columns()).toHaveLength(7);
    expect(columns().map((column) => column.querySelector('.week-col-title').textContent)).toEqual([
      'Mon30',
      'Tue1',
      'Wed2',
      'Thu3',
      'Fri4',
      'Sat5',
      'Sun6',
    ]);
    expect(columns()[2]).toHaveClass('is-today');
    const link = within(columns()[2]).getByRole('link');
    expect(link).toHaveAttribute('href', '/appointments/a-today');
    expect(link).toHaveTextContent('3:00 PM');
    expect(link).toHaveTextContent('Scheduled');
    expect(within(columns()[3]).getByRole('link')).toHaveAttribute('href', '/appointments/a-tomorrow');
    expect(within(columns()[1]).getByRole('link')).toHaveTextContent('Completed');
    expect(within(columns()[0]).getByText('No appointments')).toBeInTheDocument();
  });

  it('moves between weeks and back to this week', async () => {
    await week();
    const thisWeek = screen.getByRole('button', { name: 'This week' });
    expect(thisWeek).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText('Dec 7 to Dec 13')).toBeInTheDocument();
    expect(screen.getAllByText('No appointments')).toHaveLength(7);
    expect(thisWeek).toBeEnabled();
    expect(columns().some((column) => column.classList.contains('is-today'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByText('Nov 23 to Nov 29')).toBeInTheDocument();

    await userEvent.click(thisWeek);
    expect(screen.getByText('Nov 30 to Dec 6')).toBeInTheDocument();
    expect(thisWeek).toBeDisabled();
  });

  it('follows the status filter', async () => {
    await week();
    await userEvent.click(screen.getByRole('button', { name: /^Closed/ }));
    expect(within(columns()[2]).queryByRole('link')).not.toBeInTheDocument();
    expect(within(columns()[1]).getByRole('link')).toHaveTextContent('Completed');
  });
});
