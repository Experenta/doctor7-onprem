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

  it('puts each part of the body under its own heading', async () => {
    sheet({ 'GET /consultations/c1': ok(consultation({ note: 'First part.', follow_up: 'Second part.' })) });
    const note = await screen.findByRole('heading', { level: 3, name: 'Note' });
    const followUp = screen.getByRole('heading', { level: 3, name: 'Follow up' });
    expect(note.nextElementSibling).toHaveTextContent('First part.');
    expect(followUp.nextElementSibling).toHaveTextContent('Second part.');
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeInTheDocument();
  });

  it('keeps the line breaks and shows a long note whole', async () => {
    const long = `${'Synthetic sentence. '.repeat(100)}End.\nSecond line.`;
    sheet({ 'GET /consultations/c1': ok(consultation({ note: long })) });
    const text = await screen.findByText(/Synthetic sentence\./);
    expect(text).toHaveClass('note-text');
    expect(text.textContent).toBe(long);
    expect(text.textContent.length).toBeGreaterThan(2000);
  });

  it('shows a body value that is not text as formatted JSON', async () => {
    sheet({ 'GET /consultations/c1': ok(consultation({ plan: { steps: 2 } })) });
    expect(await screen.findByText(/"steps": 2/)).toHaveClass('note-text');
  });

  it('says "Saved" to the professional and "Read only" to every other reader', async () => {
    const first = sheet({ 'GET /consultations/c1': ok(consultation()) });
    expect(await screen.findByText('Saved')).toHaveClass('chip-teal');
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();
    first.unmount();
    const second = sheet({ 'GET /consultations/c1': ok(consultation()) }, 'client');
    expect(await screen.findByText('Read only')).toHaveClass('chip-purple');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    second.unmount();
    sheet({ 'GET /consultations/c1': ok(consultation()) }, 'admin');
    expect(await screen.findByText('Read only')).toBeInTheDocument();
  });

  it('says that opening the sheet is recorded in the audit log', async () => {
    sheet({ 'GET /consultations/c1': ok(consultation()) });
    expect(await screen.findByText('Opening this sheet is recorded in the audit log.')).toBeInTheDocument();
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

  it('shows what is saved: nothing written, then not saved yet', async () => {
    form();
    const field = await screen.findByLabelText('Consultation note');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing written yet');
    await userEvent.type(field, 'A note');
    expect(screen.getByRole('status')).toHaveTextContent('Not saved yet');
  });

  it('says "Saving" while the request runs', async () => {
    form({ 'POST /consultations': never });
    await userEvent.type(await screen.findByLabelText('Consultation note'), 'A note');
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saving');
  });

  it('says "Not saved" when the request fails, with the reason in the alert', async () => {
    form({ 'POST /consultations': fail(500, 'internal_error', 'x') });
    await userEvent.type(await screen.findByLabelText('Consultation note'), 'A note');
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
    expect(screen.getByRole('status')).toHaveTextContent('Not saved');
    expect(screen.getByRole('status')).not.toHaveTextContent('Not saved yet');
  });

  it('counts the characters, and describes the field with the count', async () => {
    form();
    const field = await screen.findByLabelText('Consultation note');
    expect(screen.getByText('0 characters')).toBeInTheDocument();
    await userEvent.type(field, 'A');
    expect(screen.getByText('1 character')).toBeInTheDocument();
    await userEvent.click(field);
    await userEvent.paste('x'.repeat(1999));
    expect(screen.getByText('2000 characters')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('2000 characters');
  });

  it('keeps the count and the error together in the description of the field', async () => {
    form();
    await userEvent.click(await screen.findByRole('button', { name: 'Save consultation' }));
    expect(screen.getByLabelText('Consultation note')).toHaveAccessibleDescription(
      'Write the consultation note before saving. 0 characters',
    );
  });

  it('accepts a note of 2000 characters and sends it whole', async () => {
    const note = 'x'.repeat(2000);
    const { calls } = form({
      'POST /consultations': ok(consultation(), 201),
      'GET /consultations/c1': ok(consultation()),
    });
    await userEvent.click(await screen.findByLabelText('Consultation note'));
    await userEvent.paste(note);
    await userEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    await screen.findByRole('heading', { name: 'Consultation sheet' });
    expect(calls.find((call) => call.method === 'POST').body.body.note).toBe(note);
  });

  it('has the same page title and back link as before', async () => {
    form();
    expect(await screen.findByRole('heading', { level: 1, name: 'Write consultation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to appointment' })).toHaveAttribute('href', '/appointments/a1');
  });
});
