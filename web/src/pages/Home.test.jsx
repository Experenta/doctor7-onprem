import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appointment, fail, FakeWebSocket, never, ok, renderApp, videoUrl } from '../test/helpers.jsx';

// Wednesday, Dec 2, 2026, 10:00 in Bogota.
const NOW = '2026-12-02T15:00:00.000Z';
const NO_ACCESS = /You do not have access to this screen/;

const at = (id, startsAt, minutes = 50, extra = {}) =>
  appointment({
    id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + minutes * 60000).toISOString(),
    ...extra,
  });

// Today 3:00 PM in Bogota, the next appointment of the set below.
const todayLater = at('a-today', '2026-12-02T20:00:00.000Z');
const friday = at('a-friday', '2026-12-04T15:00:00.000Z');
const yesterday = at('a-past', '2026-12-01T15:00:00.000Z', 50, { status: 'completed' });
const cancelled = at('a-cancelled', '2026-12-03T15:00:00.000Z', 50, { status: 'cancelled' });
const list = ok({ items: [yesterday, todayLater, cancelled, friday] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
});

const tile = (label) => screen.getByText(label).closest('.stat');

describe('Welcome band', () => {
  it('greets every role with the date and the role, and nothing else in the gradient', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [] }) }, 'client');
    const heading = await screen.findByRole('heading', { name: 'Welcome, Luis Mora' });
    const band = heading.closest('.welcome-band');
    expect(within(band).getByText('Wednesday, Dec 2')).toBeInTheDocument();
    expect(within(band).getByText('Client')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Home for a professional', () => {
  const home = (extra = {}) => renderApp('/', { 'GET /appointments': list, ...extra }, 'professional');

  it('shows the next appointment as the hero card, in Bogota time', async () => {
    home();
    const hero = await screen.findByRole('region', { name: 'Next appointment' });
    expect(within(hero).getByText('3:00 PM')).toHaveClass('hero-time');
    expect(within(hero).getByText(/Dec 2, 2026, 3:00\sPM\sGMT-5/)).toBeInTheDocument();
    expect(within(hero).getByText('u-luis')).toBeInTheDocument();
    expect(within(hero).getByText('Client')).toBeInTheDocument();
    expect(within(hero).getByText('Starts in 5 h')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'Open next appointment' })).toHaveAttribute('href', '/appointments/a-today');
    expect(within(hero).getByRole('button', { name: 'Start video meeting' })).toBeEnabled();
  });

  it('says "Happening now" while the appointment runs', async () => {
    const running = at('a-now', '2026-12-02T14:30:00.000Z', 60);
    renderApp('/', { 'GET /appointments': ok({ items: [running] }) }, 'professional');
    const hero = await screen.findByRole('region', { name: 'Next appointment' });
    expect(within(hero).getByText('Happening now')).toBeInTheDocument();
  });

  it('shows three figures: upcoming, this week, and past', async () => {
    home();
    await screen.findByRole('region', { name: 'Next appointment' });
    expect(within(tile('Upcoming appointments')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Appointments this week')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Past appointments')).getByText('1')).toBeInTheDocument();
  });

  it('draws the week with one dot for each appointment that is not cancelled', async () => {
    home();
    await screen.findByRole('region', { name: 'Next appointment' });
    const days = document.querySelectorAll('.week-strip .week-day');
    expect(days).toHaveLength(7);
    expect([...days].map((day) => day.querySelectorAll('.week-dot').length)).toEqual([0, 1, 1, 0, 1, 0, 0]);
    expect(days[2]).toHaveClass('is-today');
    expect(days[2]).toHaveTextContent('Wednesday, Dec 2: 1 appointment');
    expect(days[3]).toHaveTextContent('Thursday, Dec 3: 0 appointments');
  });

  it('lists what is scheduled for today', async () => {
    home();
    const today = (await screen.findByRole('heading', { name: 'Today' })).closest('section');
    expect(within(today).getByText('3:00 PM')).toBeInTheDocument();
    expect(within(today).getByText('u-luis')).toBeInTheDocument();
    expect(within(today).getByText('Scheduled')).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: /^Open the appointment at 3:00\sPM$/ })).toHaveAttribute('href', '/appointments/a-today');
  });

  it('says so when nothing is scheduled for today', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [friday] }) }, 'professional');
    expect(await screen.findByText('Nothing is scheduled for today.')).toBeInTheDocument();
  });

  it('teaches the first step when there is no upcoming appointment, with one scheduling link', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [] }) }, 'professional');
    expect(await screen.findByText('No upcoming appointments')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Schedule an appointment' })).toHaveLength(1);
    expect(within(tile('Upcoming appointments')).getByText('0')).toBeInTheDocument();
  });

  it('starts the stored meeting, then opens the appointment where it is shown', async () => {
    const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7room');
    const { calls } = home({
      'POST /appointments/a-today/meeting': ok({ provider: 'jitsi', url: jitsiUrl }, 201),
      'GET /appointments/a-today': ok(todayLater),
      'GET /appointments/a-today/meeting': ok({ provider: 'jitsi', url: jitsiUrl }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Start video meeting' }));
    expect(await screen.findByRole('heading', { name: 'Appointment' })).toBeInTheDocument();
    expect(await screen.findByTitle('Video consultation')).toHaveAttribute('src', jitsiUrl);
    const post = calls.find((call) => call.method === 'POST' && call.path === '/appointments/a-today/meeting');
    expect(post.init.headers['Content-Type']).toBe('application/json');
    expect(post.init.credentials).toBe('include');
  });

  it('marks the button busy while the meeting starts', async () => {
    home({ 'POST /appointments/a-today/meeting': never });
    await userEvent.click(await screen.findByRole('button', { name: 'Start video meeting' }));
    const busy = await screen.findByRole('button', { name: 'Starting video meeting' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the problem, and lets the professional start again', async () => {
    home({ 'POST /appointments/a-today/meeting': fail(503, 'video_not_configured', 'x') });
    await userEvent.click(await screen.findByRole('button', { name: 'Start video meeting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
    expect(screen.getByRole('button', { name: 'Start video meeting' })).toBeEnabled();
  });

  it('explains a closed appointment', async () => {
    home({ 'POST /appointments/a-today/meeting': fail(409, 'appointment_closed', 'x') });
    await userEvent.click(await screen.findByRole('button', { name: 'Start video meeting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This appointment is not scheduled, so a meeting cannot be started.');
  });

  it('does not ask for a meeting, because only the client reads it', async () => {
    const { calls } = home();
    await screen.findByRole('region', { name: 'Next appointment' });
    expect(calls.some((call) => call.path.endsWith('/meeting'))).toBe(false);
  });

  it('shows the four states: loading, error with retry, no permission, and the data', async () => {
    const first = renderApp('/', { 'GET /appointments': never }, 'professional');
    expect(await screen.findByText('Loading')).toBeInTheDocument();
    first.unmount();

    let attempts = 0;
    renderApp('/', {
      'GET /appointments': () => {
        attempts += 1;
        return attempts === 1 ? fail(500, 'internal_error', 'x') : list;
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Appointments could not load');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Next appointment' })).toBeInTheDocument();
  });

  it('shows no permission when the API refuses the list', async () => {
    renderApp('/', { 'GET /appointments': fail(403, 'forbidden', 'x') }, 'professional');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});

describe('Home for a client', () => {
  const GET_MEETING = 'GET /appointments/a-today/meeting';
  const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7room');
  const home = (extra = {}) => renderApp('/', { 'GET /appointments': list, ...extra }, 'client');

  it('shows the next appointment with the professional, and no start button', async () => {
    home();
    const hero = await screen.findByRole('region', { name: 'Next appointment' });
    expect(within(hero).getByText('u-ana')).toBeInTheDocument();
    expect(within(hero).getByText('Professional')).toBeInTheDocument();
    expect(within(hero).getByText(/Dec 2, 2026, 3:00\sPM\sGMT-5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
  });

  it('tells the client that the professional has not started, with a pulse that assistive technology skips', async () => {
    home();
    const note = await screen.findByText('Your professional has not started yet');
    expect(note).toHaveAttribute('role', 'status');
    expect(note.querySelector('.pulse-dot')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('link', { name: 'Join video meeting' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open next appointment' })).toHaveAttribute('href', '/appointments/a-today');
  });

  it('says "Room ready" with a button when the meeting is stored', async () => {
    home({ [GET_MEETING]: ok({ provider: 'jitsi', url: jitsiUrl }) });
    expect(await screen.findByText('Room ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join video meeting' })).toHaveAttribute('href', '/appointments/a-today');
    expect(screen.queryByText('Your professional has not started yet')).not.toBeInTheDocument();
  });

  it('refuses a meeting address that is not safe, and sends the client to the appointment', async () => {
    home({ [GET_MEETING]: ok({ provider: 'jitsi', url: 'javascript:alert(1)' }) });
    expect(await screen.findByText(/The room could not be checked/)).toBeInTheDocument();
    expect(screen.queryByText('Room ready')).not.toBeInTheDocument();
  });

  it('does not claim the room is missing when the check fails for another reason', async () => {
    home({ [GET_MEETING]: fail(500, 'internal_error', 'x') });
    expect(await screen.findByText(/The room could not be checked/)).toBeInTheDocument();
    expect(screen.queryByText('Your professional has not started yet')).not.toBeInTheDocument();
  });

  it('lists the appointments after the next one', async () => {
    home();
    const section = (await screen.findByRole('heading', { name: 'Coming up' })).closest('section');
    expect(within(section).getByRole('link', { name: /Dec 4, 2026, 10:00\sAM\sGMT-5/ })).toHaveAttribute('href', '/appointments/a-friday');
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
  });

  it('explains that the professional schedules appointments, when there is none', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [] }) }, 'client');
    expect(await screen.findByText('No upcoming appointments')).toBeInTheDocument();
    expect(screen.getByText(/Your professional schedules appointments/)).toBeInTheDocument();
  });

  it('offers a link to the appointments, and none to create one', async () => {
    renderApp('/', { 'GET /appointments': ok({ items: [] }) }, 'client');
    expect(await screen.findByRole('link', { name: 'View appointments' })).toHaveAttribute('href', '/appointments');
    expect(screen.queryByRole('link', { name: 'Schedule an appointment' })).not.toBeInTheDocument();
  });

  it('shows the error with a retry and the no-permission state', async () => {
    const first = renderApp('/', { 'GET /appointments': fail(500, 'internal_error', 'x') }, 'client');
    expect(await screen.findByRole('alert')).toHaveTextContent('Appointments could not load');
    first.unmount();
    renderApp('/', { 'GET /appointments': fail(403, 'forbidden', 'x') }, 'client');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});

// The client asks again every 15 seconds while the room is not ready. These tests need
// the clock for timers too.
describe('the client waits for the room', () => {
  const GET_MEETING = 'GET /appointments/a-today/meeting';
  const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7room');
  let visibility = 'visible';

  // The screens load lazily. Load them with the real clock, so the fake clock never waits for a file.
  beforeAll(async () => {
    await import('./Home.jsx');
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    delete document.visibilityState;
  });

  const elapse = (ms) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const settle = async () => {
    for (let i = 0; i < 10; i += 1) await elapse(0);
  };
  const meetingCalls = (calls) => calls.filter((call) => call.method === 'GET' && call.path === '/appointments/a-today/meeting');

  function waiting() {
    const state = { answer: fail(404, 'no_meeting', 'x') };
    const api = renderApp('/', { 'GET /appointments': list, [GET_MEETING]: () => state.answer }, 'client');
    return { ...api, state };
  }

  it('asks every 15 seconds, then stops when the room is ready', async () => {
    const { calls, state } = waiting();
    await settle();
    expect(screen.getByText('Your professional has not started yet')).toBeInTheDocument();
    expect(meetingCalls(calls)).toHaveLength(1);

    await elapse(14999);
    expect(meetingCalls(calls)).toHaveLength(1);
    await elapse(1);
    expect(meetingCalls(calls)).toHaveLength(2);

    state.answer = ok({ provider: 'jitsi', url: jitsiUrl });
    await elapse(15000);
    expect(screen.getByText('Room ready')).toBeInTheDocument();
    expect(meetingCalls(calls)).toHaveLength(3);

    await elapse(120000);
    expect(meetingCalls(calls)).toHaveLength(3);
  });

  it('does not ask while the tab is hidden', async () => {
    const { calls } = waiting();
    await settle();
    visibility = 'hidden';
    await elapse(60000);
    expect(meetingCalls(calls)).toHaveLength(1);
    visibility = 'visible';
    await elapse(15000);
    expect(meetingCalls(calls)).toHaveLength(2);
  });

  it('stops asking when the client leaves the screen', async () => {
    const { calls, unmount } = waiting();
    await settle();
    unmount();
    await elapse(120000);
    expect(meetingCalls(calls)).toHaveLength(1);
  });
});

describe('Home for an administrator', () => {
  const home = (items = [yesterday, todayLater, cancelled, friday]) =>
    renderApp('/', { 'GET /appointments': ok({ items }) }, 'admin');

  it('summarizes the center by status', async () => {
    home();
    const group = await screen.findByRole('group', { name: 'Appointments by status' });
    expect(within(within(group).getByText('Scheduled').closest('.stat')).getByText('2')).toBeInTheDocument();
    expect(within(within(group).getByText('Completed').closest('.stat')).getByText('1')).toBeInTheDocument();
    expect(within(within(group).getByText('Cancelled').closest('.stat')).getByText('1')).toBeInTheDocument();
    expect(within(group).getByText('4 in total')).toBeInTheDocument();
  });

  it('lists the next appointments with both people', async () => {
    home();
    const section = (await screen.findByRole('heading', { name: 'Coming up' })).closest('section');
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getAllByText('u-ana with u-luis')).toHaveLength(2);
  });

  it('has the New appointment button in the band', async () => {
    home();
    const heading = await screen.findByRole('heading', { name: 'Welcome, Rosa Admin' });
    const band = heading.closest('.welcome-band');
    expect(within(band).getByRole('link', { name: 'New appointment' })).toHaveAttribute('href', '/appointments/new');
  });

  it('teaches the first step when the center has no appointment', async () => {
    home([]);
    expect(await screen.findByText('No appointments yet')).toBeInTheDocument();
  });

  it('shows no permission when the API refuses the list', async () => {
    renderApp('/', { 'GET /appointments': fail(403, 'forbidden', 'x') }, 'admin');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});

describe('Home for an auditor', () => {
  const entry = (id, occurredAt, outcome = 'success') => ({
    id,
    occurredAt,
    actorId: 'u-luis',
    centerId: 'center-1',
    action: 'consultation.read',
    targetType: 'consultation',
    targetId: 'c1',
    outcome,
    reason: null,
    ip: '127.0.0.1',
  });
  const home = (items) => renderApp('/', { 'GET /audit': ok({ items }) }, 'auditor');

  it('counts the entries and the denied entries of today, in Bogota time', async () => {
    home([
      entry('e1', '2026-12-02T14:00:00.000Z'),
      entry('e2', '2026-12-02T13:00:00.000Z', 'denied'),
      entry('e3', '2026-12-02T12:00:00.000Z', 'denied'),
      entry('e4', '2026-12-02T04:00:00.000Z', 'denied'), // 11 PM of the day before in Bogota
      entry('e5', '2026-12-01T15:00:00.000Z'),
    ]);
    await screen.findByText('Audit entries today');
    expect(within(tile('Audit entries today')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Denied today')).getByText('2')).toBeInTheDocument();
  });

  it('shows a plus sign when the answer is full and all from today', async () => {
    home(Array.from({ length: 100 }, (_, index) => entry(`e${index}`, '2026-12-02T14:00:00.000Z')));
    await screen.findByText('Audit entries today');
    expect(within(tile('Audit entries today')).getByText('100+')).toBeInTheDocument();
  });

  it('links to the audit log and asks for no appointment data', async () => {
    const { calls } = home([entry('e1', '2026-12-02T14:00:00.000Z')]);
    expect(await screen.findByRole('link', { name: 'Open audit log' })).toHaveAttribute('href', '/audit');
    expect(calls.some((call) => call.path === '/appointments')).toBe(false);
  });

  it('shows the four states: loading, empty, error with retry, and no permission', async () => {
    const first = renderApp('/', { 'GET /audit': never }, 'auditor');
    expect(await screen.findByText('Loading')).toBeInTheDocument();
    first.unmount();

    const second = home([]);
    expect(await screen.findByText('No audit entries yet')).toBeInTheDocument();
    second.unmount();

    const third = renderApp('/', { 'GET /audit': fail(500, 'internal_error', 'x') }, 'auditor');
    expect(await screen.findByRole('alert')).toHaveTextContent('The audit summary could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    third.unmount();

    renderApp('/', { 'GET /audit': fail(403, 'forbidden', 'x') }, 'auditor');
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });
});
