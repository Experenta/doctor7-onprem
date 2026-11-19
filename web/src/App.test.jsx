import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { appointment, fail, never, ok, renderApp } from './test/helpers.jsx';

const NO_ACCESS = /You do not have access to this screen/;

describe('session and redirects', () => {
  it('sends a visitor without a session to the sign-in screen', async () => {
    renderApp('/appointments', {}, null);
    expect(await screen.findByRole('heading', { name: 'Sign in to Doctor7' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/login');
  });

  it('sends a visitor without a session away from every private screen', async () => {
    for (const path of ['/', '/audit', '/appointments/new', '/consultations/c1']) {
      const { unmount } = renderApp(path, {}, null);
      expect(await screen.findByRole('heading', { name: 'Sign in to Doctor7' })).toBeInTheDocument();
      unmount();
    }
  });

  it('shows a skeleton while the session is checked', () => {
    renderApp('/', { 'GET /auth/me': never }, 'professional');
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  });

  it('shows an error with a retry when the session cannot be checked', async () => {
    renderApp('/', { 'GET /auth/me': fail(500, 'internal_error', 'x') }, 'professional');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session could not be checked');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('moves a signed-in user from sign-in to Home', async () => {
    renderApp('/login', { 'GET /appointments': ok({ items: [] }) }, 'client');
    expect(await screen.findByRole('heading', { name: /Welcome, Luis Mora/ })).toBeInTheDocument();
  });

  it('signs out through the API and returns to sign-in', async () => {
    const { calls } = renderApp('/', { 'GET /appointments': ok({ items: [] }), 'POST /auth/logout': { status: 204, json: null } }, 'client');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Doctor7' })).toBeInTheDocument();
    const logout = calls.find((call) => call.path === '/auth/logout');
    expect(logout.init.headers['Content-Type']).toBe('application/json');
    expect(logout.init.credentials).toBe('include');
  });
});

describe('role navigation', () => {
  const linkNames = async (role) => {
    renderApp('/', { 'GET /appointments': ok({ items: [] }) }, role);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    return within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
  };

  it('shows each role only its own links', async () => {
    expect(await linkNames('professional')).toEqual(['Home', 'Appointments', 'New appointment']);
  });

  it('hides the audit and creation links from a client', async () => {
    expect(await linkNames('client')).toEqual(['Home', 'Appointments']);
  });

  it('shows the auditor only Home and the audit log', async () => {
    expect(await linkNames('auditor')).toEqual(['Home', 'Audit log']);
  });
});

describe('no permission', () => {
  it('blocks a client from audit and from creating appointments', async () => {
    const first = renderApp('/audit', {}, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
    expect(first.calls.some((call) => call.path === '/audit')).toBe(false);
    first.unmount();

    renderApp('/appointments/new', {}, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('blocks an auditor from appointments and consultations', async () => {
    const first = renderApp('/appointments', {}, 'auditor');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
    expect(first.calls.some((call) => call.path === '/appointments')).toBe(false);
    first.unmount();

    renderApp('/consultations/c1', {}, 'auditor');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('blocks an administrator from writing a consultation', async () => {
    renderApp('/appointments/a1/consultation', {}, 'admin');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('shows the same state for an unknown path', async () => {
    renderApp('/nothing-here', {}, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});

describe('Home', () => {
  const future = appointment({ id: 'a9', startsAt: '2099-01-05T15:00:00.000Z', endsAt: '2099-01-05T15:50:00.000Z' });

  it('shows the count and the next appointment in Bogota time', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [future] }) }, 'professional');
    expect(await screen.findByText('Upcoming appointments')).toBeInTheDocument();
    expect(screen.getByText(/Jan 5, 2099, 10:00\sAM\sGMT-5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schedule an appointment' })).toBeInTheDocument();
  });

  it('shows a skeleton, then an error with retry', async () => {
    renderApp('/', { 'GET /appointments': fail(500, 'internal_error', 'x') }, 'client');
    expect(await screen.findByRole('alert')).toHaveTextContent('Appointments could not load');
  });

  it('shows the auditor a link to the audit log and no appointment data', async () => {
    const { calls } = renderApp('/', {}, 'auditor');
    expect(await screen.findByRole('link', { name: 'Open audit log' })).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/appointments')).toBe(false);
  });

  it('shows no permission when the API refuses the list', async () => {
    renderApp('/', { 'GET /appointments': fail(403, 'forbidden', 'x') }, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', async () => {
    renderApp('/', { 'GET /appointments': never }, 'client');
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });
});
