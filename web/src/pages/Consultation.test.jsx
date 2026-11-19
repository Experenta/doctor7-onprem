import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fail, never, ok, renderApp } from '../test/helpers.jsx';

const NO_ACCESS = /You do not have access to this screen/;
const consultation = (body = { note: 'Synthetic note for the sheet.' }) => ({
  id: 'c1',
  appointmentId: 'a1',
  body,
  createdAt: '2026-12-02T16:00:00.000Z',
});

describe('Consultation sheet', () => {
  const sheet = (extra = {}, role = 'professional') => renderApp('/consultations/c1', extra, role);

  it('shows a skeleton while loading', async () => {
    sheet({ 'GET /consultations/c1': never });
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });

  it('shows the body as labeled fields with the Bogota time', async () => {
    sheet({ 'GET /consultations/c1': ok(consultation({ note: 'Synthetic note for the sheet.', follow_up: 'Next week' })) });
    expect(await screen.findByRole('heading', { name: 'Consultation sheet' })).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Synthetic note for the sheet.')).toBeInTheDocument();
    expect(screen.getByText('Follow up')).toBeInTheDocument();
    expect(screen.getByText(/Dec 2, 2026, 11:00\sAM\sGMT-5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to appointment' })).toHaveAttribute('href', '/appointments/a1');
  });

  it('lets a client and an administrator read it', async () => {
    const first = sheet({ 'GET /consultations/c1': ok(consultation()) }, 'client');
    expect(await screen.findByText('Synthetic note for the sheet.')).toBeInTheDocument();
    first.unmount();
    sheet({ 'GET /consultations/c1': ok(consultation()) }, 'admin');
    expect(await screen.findByText('Synthetic note for the sheet.')).toBeInTheDocument();
  });

  it('explains an empty consultation', async () => {
    sheet({ 'GET /consultations/c1': ok(consultation({})) });
    expect(await screen.findByText('This consultation has no notes')).toBeInTheDocument();
  });

  it('says plainly when it is not found', async () => {
    sheet({ 'GET /consultations/c1': fail(404, 'not_found', 'x') });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consultation not found');
  });

  it('shows an error with a retry', async () => {
    sheet({ 'GET /consultations/c1': fail(500, 'internal_error', 'x') });
    expect(await screen.findByRole('alert')).toHaveTextContent('The consultation could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows no permission on a 403', async () => {
    sheet({ 'GET /consultations/c1': fail(403, 'forbidden', 'x') });
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('shows no permission to an auditor without calling the API', async () => {
    const { calls } = sheet({}, 'auditor');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith('/consultations'))).toBe(false);
  });
});

describe('New consultation', () => {
  const form = (extra = {}, role = 'professional') => renderApp('/appointments/a1/consultation', extra, role);

  it('asks for a note before saving', async () => {
    const { calls } = form();
    await userEvent.click(await screen.findByRole('button', { name: 'Save consultation' }));
    expect(screen.getByText('Write the consultation note before saving.')).toBeInTheDocument();
    expect(screen.getByLabelText('Consultation note')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('saves the note and opens the sheet', async () => {
    const { calls } = form({
      'POST /consultations': ok(consultation(), 201),
      'GET /consultations/c1': ok(consultation()),
    });
    await userEvent.type(await screen.findByLabelText('Consultation note'), 'Synthetic note for the sheet.');
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    expect(await screen.findByRole('heading', { name: 'Consultation sheet' })).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post.body).toEqual({ appointmentId: 'a1', body: { note: 'Synthetic note for the sheet.' } });
    expect(post.init.headers['Content-Type']).toBe('application/json');
    expect(post.init.credentials).toBe('include');
  });

  it('shows how to recover when saving fails', async () => {
    form({ 'POST /consultations': fail(403, 'forbidden', 'x') });
    await userEvent.type(await screen.findByLabelText('Consultation note'), 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask an administrator if you need access.');
    expect(screen.getByLabelText('Consultation note')).toHaveValue('text');
  });

  it('marks the button busy while saving', async () => {
    form({ 'POST /consultations': never });
    await userEvent.type(await screen.findByLabelText('Consultation note'), 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    const busy = await screen.findByRole('button', { name: 'Saving consultation' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });

  it('is closed to clients', async () => {
    form({}, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});
