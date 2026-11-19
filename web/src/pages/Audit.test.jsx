import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fail, never, ok, renderApp } from '../test/helpers.jsx';

const NO_ACCESS = /You do not have access to this screen/;
const entry = (overrides = {}) => ({
  id: 'e1',
  occurredAt: '2026-11-19T03:26:00.123Z',
  actorId: 'u-luis',
  centerId: 'center-1',
  action: 'consultation.read',
  targetType: 'consultation',
  targetId: 'c1',
  outcome: 'denied',
  reason: 'not_participant',
  ip: '127.0.0.1',
  ...overrides,
});
const audit = (extra = {}, role = 'auditor') => renderApp('/audit', extra, role);

describe('Audit', () => {
  it('shows a skeleton while loading', async () => {
    audit({ 'GET /audit': never });
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });

  it('lists entries with the time in Bogota', async () => {
    audit({ 'GET /audit': ok({ items: [entry(), entry({ id: 'e2', actorId: null, targetType: null, targetId: null, reason: null, outcome: 'success' })] }) });
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText(/Nov 18, 2026, 10:26\sPM\sGMT-5/, { selector: 'td' })).toHaveLength(2);
    expect(within(table).getByText('consultation c1')).toBeInTheDocument();
    expect(within(table).getByText('denied')).toBeInTheDocument();
    expect(within(table).getAllByText('n/a').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Time', 'Actor', 'Action', 'Target', 'Outcome', 'Reason', 'IP',
    ]);
  });

  it('reloads with the chosen filters', async () => {
    const { calls } = audit({ 'GET /audit': ok({ items: [entry()] }) });
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Denied' }));
    await userEvent.type(screen.getByLabelText('Action'), 'consultation.read');
    await userEvent.type(screen.getByLabelText('Actor ID'), 'u-luis');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByRole('table');
    const last = calls.filter((call) => call.path === '/audit').at(-1);
    const query = new URLSearchParams(last.input.split('?')[1]);
    expect(query.get('outcome')).toBe('denied');
    expect(query.get('action')).toBe('consultation.read');
    expect(query.get('actorId')).toBe('u-luis');
    expect(last.init.credentials).toBe('include');
  });

  it('applies an outcome chip at once and keeps the search it already applied', async () => {
    const { calls } = audit({ 'GET /audit': ok({ items: [entry()] }) });
    await screen.findByRole('table');
    const group = screen.getByRole('group', { name: 'Outcome' });
    expect(within(group).getByRole('button', { name: 'All outcomes' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.type(screen.getByLabelText('Actor ID'), 'u-luis');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Failure' }));
    await screen.findByRole('table');

    expect(within(group).getByRole('button', { name: 'Failure' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All outcomes' })).toHaveAttribute('aria-pressed', 'false');
    const last = calls.filter((call) => call.path === '/audit').at(-1);
    const query = new URLSearchParams(last.input.split('?')[1]);
    expect(query.get('outcome')).toBe('failure');
    expect(query.get('actorId')).toBe('u-luis');
    expect(query.has('action')).toBe(false);
  });

  it('does not apply a typed search until the button is pressed', async () => {
    const { calls } = audit({ 'GET /audit': ok({ items: [entry()] }) });
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Action'), 'consultation.read');
    expect(calls.filter((call) => call.path === '/audit')).toHaveLength(1);
  });

  it('offers to clear the filters beside the search while some are active, and not before', async () => {
    audit({ 'GET /audit': ok({ items: [entry()] }) });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Denied' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'All outcomes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows the outcome as a chip with the word, for success, failure, and denied', async () => {
    audit({
      'GET /audit': ok({
        items: [
          entry({ id: 'e1', outcome: 'success' }),
          entry({ id: 'e2', outcome: 'failure' }),
          entry({ id: 'e3', outcome: 'denied' }),
        ],
      }),
    });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('success')).toHaveClass('chip-teal');
    expect(within(table).getByText('failure')).toHaveClass('chip-magenta');
    expect(within(table).getByText('denied')).toHaveClass('chip-magenta');
    for (const word of ['success', 'failure', 'denied']) {
      expect(within(table).getByText(word).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('counts the entries above the table', async () => {
    audit({ 'GET /audit': ok({ items: [entry(), entry({ id: 'e2' })] }) });
    expect(await screen.findByText('2 entries.')).toBeInTheDocument();
  });

  it('says that the newest 100 are shown when the list is full', async () => {
    const items = Array.from({ length: 100 }, (_, index) => entry({ id: `e${index}` }));
    audit({ 'GET /audit': ok({ items }) });
    expect(await screen.findByText(/100 entries\. These are the newest/)).toBeInTheDocument();
  });

  it('opens the detail of a row in a side panel, and moves the focus to it', async () => {
    audit({ 'GET /audit': ok({ items: [entry(), entry({ id: 'e2', action: 'appointment.read', outcome: 'success', reason: null })] }) });
    await screen.findByRole('table');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'consultation.read, show details' }));
    const panel = screen.getByRole('complementary', { name: 'Entry details' });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entry details' })).toHaveFocus();
    expect(within(panel).getByText(/Nov 18, 2026, 10:26\sPM\sGMT-5/)).toBeInTheDocument();
    expect(within(panel).getByText('u-luis')).toBeInTheDocument();
    expect(within(panel).getByText('consultation c1')).toBeInTheDocument();
    expect(within(panel).getByText('not_participant')).toBeInTheDocument();
    expect(within(panel).getByText('127.0.0.1')).toBeInTheDocument();
    expect(within(panel).getByText('denied')).toBeInTheDocument();
    expect(within(panel).getByText(/hold no clinical text/)).toBeInTheDocument();
  });

  it('opens the detail when any part of the row is clicked, and marks the open row', async () => {
    audit({ 'GET /audit': ok({ items: [entry()] }) });
    const table = await screen.findByRole('table');
    const row = within(table).getByText('not_participant').closest('tr');
    await userEvent.click(within(table).getByText('not_participant'));
    expect(screen.getByRole('complementary', { name: 'Entry details' })).toBeInTheDocument();
    expect(row).toHaveClass('is-selected');
    expect(within(table).getByRole('button', { name: /show details/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the detail with the button or Escape, and gives the focus back to the row', async () => {
    audit({ 'GET /audit': ok({ items: [entry()] }) });
    await screen.findByRole('table');
    const opener = screen.getByRole('button', { name: 'consultation.read, show details' });

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(opener).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('shows the n/a words in the panel for the fields that an entry does not have', async () => {
    audit({ 'GET /audit': ok({ items: [entry({ actorId: null, targetType: null, targetId: null, reason: null, ip: null })] }) });
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /show details/ }));
    expect(within(screen.getByRole('complementary')).getAllByText('n/a')).toHaveLength(4);
  });

  it('closes the detail when a new list no longer holds the entry', async () => {
    let calls = 0;
    audit({
      'GET /audit': () => {
        calls += 1;
        return ok({ items: [calls === 1 ? entry() : entry({ id: 'e9', action: 'appointment.read' })] });
      },
    });
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /show details/ }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Denied' }));
    expect(await screen.findByRole('button', { name: 'appointment.read, show details' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('explains how to widen an empty result and can clear the filters', async () => {
    audit({ 'GET /audit': ok({ items: [] }) });
    expect(await screen.findByText('No audit entries match')).toBeInTheDocument();
    expect(screen.getByText(/Clear the filters/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No audit entries match')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    audit({ 'GET /audit': fail(500, 'internal_error', 'x') });
    expect(await screen.findByRole('alert')).toHaveTextContent('The audit log could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows no permission on a 403', async () => {
    audit({ 'GET /audit': fail(403, 'forbidden', 'x') });
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('shows no permission to every role except the auditor, without calling the API', async () => {
    for (const role of ['professional', 'client', 'admin']) {
      const view = audit({}, role);
      expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
      expect(view.calls.some((call) => call.path === '/audit')).toBe(false);
      view.unmount();
    }
  });
});
