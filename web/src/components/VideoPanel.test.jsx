import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, mockApi, ok, videoUrl } from '../test/helpers.jsx';
import VideoPanel from './VideoPanel.jsx';

const GET_MEETING = 'GET /appointments/a1/meeting';
const POST_MEETING = 'POST /appointments/a1/meeting';
const NOT_STARTED = /Your professional has not started the meeting yet/;
const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7-room');
const meetUrl = videoUrl('meet.example.test', '/abc-defg-hij');

// A fake clock. `elapse` moves it and lets the pending requests finish.
async function elapse(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const settle = () => elapse(0);

let visibility = 'visible';
function setVisibility(value) {
  visibility = value;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  delete document.visibilityState;
});

const getCalls = (calls) => calls.filter((call) => call.method === 'GET' && call.path === '/appointments/a1/meeting');

// The answer of GET changes with `state.answer`, so a test can start the meeting later.
function waitingApi(extra = {}) {
  const state = { answer: fail(404, 'no_meeting', 'The meeting has not been started yet.') };
  const api = mockApi({ [GET_MEETING]: () => state.answer, ...extra });
  return { ...api, state };
}

describe('the client waits for the meeting', () => {
  it('shows the notice, asks again every 15 seconds, and stops when the meeting appears', async () => {
    const { calls, state } = waitingApi();
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();

    expect(screen.getByText(NOT_STARTED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
    expect(getCalls(calls)).toHaveLength(1);

    await elapse(14999);
    expect(getCalls(calls)).toHaveLength(1);
    await elapse(1);
    expect(getCalls(calls)).toHaveLength(2);
    await elapse(15000);
    expect(getCalls(calls)).toHaveLength(3);
    expect(screen.getByText(NOT_STARTED)).toBeInTheDocument();

    state.answer = ok({ provider: 'jitsi', url: jitsiUrl });
    await elapse(15000);
    expect(getCalls(calls)).toHaveLength(4);
    expect(screen.queryByText(NOT_STARTED)).not.toBeInTheDocument();
    expect(screen.getByTitle('Video consultation')).toHaveAttribute('src', jitsiUrl);

    await elapse(120000);
    expect(getCalls(calls)).toHaveLength(4);
  });

  it('opens a Meet meeting in a new tab with rel noopener noreferrer, and never in an iframe', async () => {
    const { state } = waitingApi();
    const { container } = render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    state.answer = ok({ provider: 'meet', url: meetUrl });
    await elapse(15000);

    const link = screen.getByRole('link', { name: 'Open Google Meet in a new tab' });
    expect(link).toHaveAttribute('href', meetUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('embeds a Jitsi meeting in an iframe and offers no link', async () => {
    const { state } = waitingApi();
    const { container } = render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    state.answer = ok({ provider: 'jitsi', url: jitsiUrl });
    await elapse(15000);

    expect(container.querySelector('iframe')).toHaveAttribute('src', jitsiUrl);
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
  });

  it('stops asking when the user leaves the screen', async () => {
    const { calls } = waitingApi();
    const view = render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    await elapse(15000);
    expect(getCalls(calls)).toHaveLength(2);

    view.unmount();
    await elapse(120000);
    expect(getCalls(calls)).toHaveLength(2);
  });

  it('does not ask while the tab is hidden, and asks again when it is visible', async () => {
    const { calls } = waitingApi();
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();

    setVisibility('hidden');
    await elapse(60000);
    expect(getCalls(calls)).toHaveLength(1);

    setVisibility('visible');
    await elapse(15000);
    expect(getCalls(calls)).toHaveLength(2);
  });

  it('does not stack requests when the server is slow', async () => {
    let release;
    let count = 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockApi({
      [GET_MEETING]: async () => {
        count += 1;
        if (count > 1) await gate;
        return fail(404, 'no_meeting', 'x');
      },
    });
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    await elapse(15000);
    await elapse(45000);
    expect(count).toBe(2);
    release();
    await settle();
  });

  it('shows a failure of the repeated request and keeps the way to try again', async () => {
    const { state } = waitingApi();
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    state.answer = fail(500, 'internal_error', 'x');
    await elapse(15000);
    expect(screen.getByRole('alert')).toHaveTextContent('The server had a problem');

    state.answer = ok({ provider: 'jitsi', url: jitsiUrl });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByTitle('Video consultation')).toBeInTheDocument();
  });

  it('does not poll for an appointment that is not scheduled, and says so', async () => {
    const { calls } = waitingApi();
    render(<VideoPanel appointmentId="a1" canStart={false} appointmentStatus="cancelled" />);
    await settle();
    expect(screen.getByText(/not scheduled, so a meeting cannot be started/)).toBeInTheDocument();
    await elapse(60000);
    expect(getCalls(calls)).toHaveLength(1);
  });
});

describe('the professional starts the meeting', () => {
  it('sees the start button, does not poll, and starts through the POST', async () => {
    const { calls } = waitingApi({ [POST_MEETING]: ok({ provider: 'jitsi', url: jitsiUrl }, 201) });
    render(<VideoPanel appointmentId="a1" canStart />);
    await settle();
    expect(screen.queryByText(NOT_STARTED)).not.toBeInTheDocument();
    await elapse(60000);
    expect(getCalls(calls)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Start video meeting' }));
    await settle();
    expect(screen.getByTitle('Video consultation')).toHaveAttribute('src', jitsiUrl);
    const post = calls.find((call) => call.method === 'POST');
    expect(post.init.headers['Content-Type']).toBe('application/json');
  });

  it('shows the stored meeting without a start button when it already exists', async () => {
    mockApi({ [GET_MEETING]: ok({ provider: 'meet', url: meetUrl }) });
    render(<VideoPanel appointmentId="a1" canStart />);
    await settle();
    expect(screen.getByRole('link', { name: 'Open Google Meet in a new tab' })).toHaveAttribute('href', meetUrl);
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
  });

  it('takes the 200 of a repeated start as the same meeting', async () => {
    waitingApi({ [POST_MEETING]: ok({ provider: 'meet', url: meetUrl }, 200) });
    render(<VideoPanel appointmentId="a1" canStart />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start video meeting' }));
    await settle();
    expect(screen.getByRole('link', { name: 'Open Google Meet in a new tab' })).toHaveAttribute('href', meetUrl);
  });

  it('says that a closed appointment cannot start a meeting', async () => {
    waitingApi({ [POST_MEETING]: fail(409, 'appointment_closed', 'x') });
    render(<VideoPanel appointmentId="a1" canStart />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Start video meeting' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('not scheduled');
  });

  it('offers no start button when the appointment is not scheduled', async () => {
    waitingApi();
    render(<VideoPanel appointmentId="a1" canStart appointmentStatus="completed" />);
    await settle();
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
    expect(screen.getByText(/not scheduled/)).toBeInTheDocument();
  });
});

describe('states', () => {
  it('shows a skeleton while the meeting loads', async () => {
    mockApi({ [GET_MEETING]: () => new Promise(() => {}) });
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    expect(screen.getByText('Loading the video meeting')).toBeInTheDocument();
  });

  it('shows an error with a retry when the first read fails', async () => {
    const { state } = waitingApi();
    state.answer = fail(500, 'internal_error', 'x');
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The server had a problem');
    state.answer = ok({ provider: 'jitsi', url: jitsiUrl });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByTitle('Video consultation')).toBeInTheDocument();
  });

  it('shows a no-permission message on a 403', async () => {
    const { state, calls } = waitingApi();
    state.answer = fail(403, 'forbidden', 'x');
    render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot open the video meeting');
    await elapse(60000);
    expect(getCalls(calls)).toHaveLength(1);
  });

  it('refuses an address that is not https', async () => {
    mockApi({ [GET_MEETING]: ok({ provider: 'jitsi', url: 'javascript:alert(1)' }) });
    const { container } = render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('not safe to open');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('refuses a provider it does not know', async () => {
    mockApi({ [GET_MEETING]: ok({ provider: 'other', url: jitsiUrl }) });
    const { container } = render(<VideoPanel appointmentId="a1" canStart={false} />);
    await settle();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
