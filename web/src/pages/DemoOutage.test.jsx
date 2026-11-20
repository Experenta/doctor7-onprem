import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import DemoOutageSwitch from '../components/DemoOutageSwitch.jsx';
import { appointment, fail, mockApi, ok, renderApp } from '../test/helpers.jsx';

const GET = 'GET /demo/meet-outage';
const POST = 'POST /demo/meet-outage';
const TITLE = 'Demo only: simulate a Google Meet outage';

describe('the demo outage switch', () => {
  it('shows nothing while it asks, and nothing when the API says the route is not there', async () => {
    const { calls } = mockApi({ [GET]: fail(404, 'not_found', 'Resource not found.') });
    const { container } = render(<DemoOutageSwitch />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(calls.filter((call) => call.path === '/demo/meet-outage')).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('shows nothing for a refusal, a closed session, or a network failure', async () => {
    for (const answer of [fail(403, 'forbidden', 'No.'), fail(401, 'unauthenticated', 'No.'), fail(500, 'internal_error', 'No.')]) {
      const { calls } = mockApi({ [GET]: answer });
      const { container, unmount } = render(<DemoOutageSwitch />);
      await waitFor(() => expect(calls).toHaveLength(1));
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      unmount();
    }
  });

  it('shows the marked switch with its state and help text when the API answers', async () => {
    mockApi({ [GET]: ok({ meetOutage: false }) });
    render(<DemoOutageSwitch />);
    const card = (await screen.findByRole('heading', { name: TITLE })).closest('section');
    expect(within(card).getByText('Outage off')).toBeInTheDocument();
    const toggle = within(card).getByRole('switch', { name: 'Simulate a Google Meet outage' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toBeEnabled();
    expect(within(card).getByText(/the meeting is created in Jitsi/)).toBeInTheDocument();
  });

  it('shows the switch on when the outage is active', async () => {
    mockApi({ [GET]: ok({ meetOutage: true }) });
    render(<DemoOutageSwitch />);
    const toggle = await screen.findByRole('switch', { name: 'Simulate a Google Meet outage' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Outage on')).toBeInTheDocument();
  });

  it('turns the outage on and off with one JSON body each, and confirms the result', async () => {
    const user = userEvent.setup();
    const state = { outage: false };
    const { calls } = mockApi({
      [GET]: () => ok({ meetOutage: state.outage }),
      [POST]: (call) => {
        state.outage = call.body.meetOutage;
        return ok({ meetOutage: state.outage });
      },
    });
    render(<DemoOutageSwitch />);
    const toggle = await screen.findByRole('switch', { name: 'Simulate a Google Meet outage' });

    await user.click(toggle);
    expect(await screen.findByText(/Outage turned on\. The next meeting a professional starts is created in Jitsi\./)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Outage on')).toBeInTheDocument();

    await user.click(screen.getByRole('switch'));
    expect(await screen.findByText(/Outage turned off\. The next meeting a professional starts is created in Google Meet\./)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.body)).toEqual([{ meetOutage: true }, { meetOutage: false }]);
    expect(posts.every((call) => call.init.headers['Content-Type'] === 'application/json')).toBe(true);
    expect(posts.every((call) => call.init.credentials === 'include')).toBe(true);
  });

  it('disables the switch while the change is in flight', async () => {
    const user = userEvent.setup();
    let release;
    mockApi({
      [GET]: ok({ meetOutage: false }),
      [POST]: () => new Promise((resolve) => (release = () => resolve(ok({ meetOutage: true })))),
    });
    render(<DemoOutageSwitch />);
    const toggle = await screen.findByRole('switch');
    await user.click(toggle);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-busy', 'true');
    release();
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  });

  it('says what went wrong when the change fails, and keeps the old state', async () => {
    const user = userEvent.setup();
    mockApi({
      [GET]: ok({ meetOutage: false }),
      [POST]: fail(502, 'demo_simulator_unavailable', 'The Google Meet simulator did not answer.'),
    });
    render(<DemoOutageSwitch />);
    await user.click(await screen.findByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Check that the service doctor7-mock-google is running/);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/Outage turned on/)).not.toBeInTheDocument();
  });

  it('shows the problem with a retry when the state cannot be read because the simulator is down', async () => {
    const user = userEvent.setup();
    const state = { answer: fail(502, 'demo_simulator_unavailable', 'The Google Meet simulator did not answer.') };
    mockApi({ [GET]: () => state.answer });
    render(<DemoOutageSwitch />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/doctor7-mock-google/);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    state.answer = ok({ meetOutage: false });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch')).toBeInTheDocument();
  });
});

describe('Home', () => {
  const list = ok({ items: [appointment({ id: 'a1', status: 'scheduled' })] });

  it('shows the switch to an administrator only when the API answers the state', async () => {
    renderApp('/', { 'GET /appointments': list, [GET]: ok({ meetOutage: false }) }, 'admin');
    expect(await screen.findByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows nothing to an administrator when the API has no demo switch', async () => {
    const { calls } = renderApp('/', { 'GET /appointments': list }, 'admin');
    await screen.findByRole('heading', { name: 'Welcome, Rosa Admin' });
    await waitFor(() => expect(calls.some((call) => call.path === '/demo/meet-outage')).toBe(true));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('never asks for the switch on the screens of the other roles', async () => {
    for (const role of ['professional', 'client']) {
      const { calls, unmount } = renderApp('/', { 'GET /appointments': ok({ items: [] }), [GET]: ok({ meetOutage: false }) }, role);
      await screen.findByRole('heading', { level: 1 });
      await screen.findByText('No upcoming appointments');
      expect(calls.some((call) => call.path === '/demo/meet-outage')).toBe(false);
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
      unmount();
    }
  });
});
