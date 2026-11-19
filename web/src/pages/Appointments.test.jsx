import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { appointment, fail, never, ok, renderApp } from '../test/helpers.jsx';

const NO_ACCESS = /You do not have access to this screen/;

describe('Appointments list', () => {
  it('shows a skeleton while loading', async () => {
    renderApp('/appointments', { 'GET /appointments': never });
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });

  it('lists appointments with dates in Bogota time and stacked-table labels', async () => {
    renderApp('/appointments', { 'GET /appointments': ok({ items: [appointment()] }) });
    const link = await screen.findByRole('link', { name: /Dec 2, 2026, 5:00\sAM\sGMT-5/ });
    expect(link).toHaveAttribute('href', '/appointments/a1');
    expect(screen.getByText(/Dec 2, 2026, 5:50\sAM\sGMT-5/)).toBeInTheDocument();
    // The filter chip has the same word, so the status is looked up inside the table.
    expect(within(screen.getByRole('table')).getByText('Scheduled')).toBeInTheDocument();
    expect(link.closest('td')).toHaveAttribute('data-label', 'Starts');
  });

  it('teaches a professional how to create the first appointment', async () => {
    renderApp('/appointments', { 'GET /appointments': ok({ items: [] }) }, 'professional');
    expect(await screen.findByText('No appointments yet')).toBeInTheDocument();
    expect(screen.getByText(/Schedule the first appointment/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /appointment/i }).length).toBeGreaterThan(0);
  });

  it('tells a client that the professional schedules appointments', async () => {
    renderApp('/appointments', { 'GET /appointments': ok({ items: [] }) }, 'client');
    expect(await screen.findByText(/Your professional schedules appointments/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New appointment' })).not.toBeInTheDocument();
  });

  it('shows an error that can be retried', async () => {
    let attempts = 0;
    renderApp('/appointments', {
      'GET /appointments': () => {
        attempts += 1;
        return attempts === 1 ? fail(500, 'internal_error', 'x') : ok({ items: [appointment()] });
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem. Try again in a moment.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Dec 2, 2026/ })).toBeInTheDocument();
  });

  it('shows no permission when the API answers 403', async () => {
    renderApp('/appointments', { 'GET /appointments': fail(403, 'forbidden', 'x') });
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});

describe('New appointment', () => {
  const fill = async () => {
    await userEvent.type(await screen.findByLabelText('Client ID'), 'u-luis');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-02' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:50' } });
  };

  it('fixes the professional ID to the signed-in professional', async () => {
    renderApp('/appointments/new', {});
    const field = await screen.findByLabelText('Professional ID');
    expect(field).toHaveValue('u-ana');
    expect(field).toHaveAttribute('readonly');
  });

  it('lets an administrator choose the professional', async () => {
    renderApp('/appointments/new', {}, 'admin');
    const field = await screen.findByLabelText('Professional ID');
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
  });

  it('names each missing field and how to fix it', async () => {
    const { calls } = renderApp('/appointments/new', {});
    await userEvent.click(await screen.findByRole('button', { name: 'Create appointment' }));
    expect(screen.getByText('Enter the client ID.')).toBeInTheDocument();
    expect(screen.getByText('Choose a date.')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('rejects an end time that is not after the start time', async () => {
    renderApp('/appointments/new', {});
    await fill();
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create appointment' }));
    expect(screen.getByText(/The end time must be after the start time/)).toBeInTheDocument();
  });

  it('sends Bogota times as UTC with JSON and the session cookie, then opens the appointment', async () => {
    const { calls } = renderApp('/appointments/new', {
      'POST /appointments': ok(appointment({ id: 'new-id' }), 201),
      'GET /appointments/new-id': ok(appointment({ id: 'new-id' })),
    });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create appointment' }));
    expect(await screen.findByRole('heading', { name: 'Appointment' })).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST' && call.path === '/appointments');
    expect(post.body).toEqual({
      professionalId: 'u-ana',
      clientId: 'u-luis',
      startsAt: '2026-12-02T15:00:00.000Z',
      endsAt: '2026-12-02T15:50:00.000Z',
    });
    expect(post.init.headers['Content-Type']).toBe('application/json');
    expect(post.init.credentials).toBe('include');
  });

  it('shows the server problem and keeps the form so the user can fix it', async () => {
    renderApp('/appointments/new', {
      'POST /appointments': fail(400, 'invalid_request', 'The client is not in your center.'),
    });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create appointment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The client is not in your center. Check the fields and try again.');
    expect(screen.getByLabelText('Client ID')).toHaveValue('u-luis');
    expect(screen.getByRole('button', { name: 'Create appointment' })).toBeEnabled();
  });

  it('disables the button and marks it busy while saving', async () => {
    renderApp('/appointments/new', { 'POST /appointments': never });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create appointment' }));
    const busy = await screen.findByRole('button', { name: 'Creating appointment' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });
});
