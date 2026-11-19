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
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'denied');
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
