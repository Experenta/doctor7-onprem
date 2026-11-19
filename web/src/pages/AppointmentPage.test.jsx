import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appointment, fail, FakeWebSocket, never, ok, renderApp, videoUrl } from '../test/helpers.jsx';

const NO_ACCESS = /You do not have access to this screen/;
const page = (extra = {}, role = 'professional') =>
  renderApp('/appointments/a1', { 'GET /appointments/a1': ok(appointment()), ...extra }, role);

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  FakeWebSocket.instances = [];
});

describe('Appointment page states', () => {
  it('shows a skeleton while loading', async () => {
    renderApp('/appointments/a1', { 'GET /appointments/a1': never });
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });

  it('shows the details in Bogota time', async () => {
    page();
    expect(await screen.findByRole('heading', { name: 'Appointment' })).toBeInTheDocument();
    expect(screen.getByText(/Dec 2, 2026, 5:00\sAM\sGMT-5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write consultation' })).toHaveAttribute('href', '/appointments/a1/consultation');
  });

  it('says plainly when the appointment is not found', async () => {
    page({ 'GET /appointments/a1': fail(404, 'not_found', 'x') });
    expect(await screen.findByRole('alert')).toHaveTextContent('Appointment not found');
    expect(screen.getByRole('link', { name: 'Back to appointments' })).toBeInTheDocument();
  });

  it('shows an error with a retry for other failures', async () => {
    page({ 'GET /appointments/a1': fail(500, 'internal_error', 'x') });
    expect(await screen.findByRole('alert')).toHaveTextContent('The appointment could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows no permission on a 403', async () => {
    page({ 'GET /appointments/a1': fail(403, 'forbidden', 'x') });
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  });

  it('does not offer a consultation to a client', async () => {
    page({}, 'client');
    await screen.findByRole('heading', { name: 'Appointment' });
    expect(screen.queryByRole('link', { name: 'Write consultation' })).not.toBeInTheDocument();
  });
});

describe('Video', () => {
  const start = async () => userEvent.click(await screen.findByRole('button', { name: 'Start video meeting' }));

  it('opens Google Meet in a new tab and never embeds it', async () => {
    const meetUrl = videoUrl('meet.example.test', '/abc-defg-hij');
    const { container, calls } = page({ 'POST /appointments/a1/meeting': ok({ provider: 'meet', url: meetUrl }, 201) });
    await start();
    const link = await screen.findByRole('link', { name: 'Open Google Meet in a new tab' });
    expect(link).toHaveAttribute('href', meetUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('iframe')).toBeNull();
    const post = calls.find((call) => call.method === 'POST' && call.path === '/appointments/a1/meeting');
    expect(post.init.headers['Content-Type']).toBe('application/json');
  });

  it('embeds Jitsi in an iframe', async () => {
    const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7-room');
    const { container } = page({ 'POST /appointments/a1/meeting': ok({ provider: 'jitsi', url: jitsiUrl }, 201) });
    await start();
    const frame = await screen.findByTitle('Video consultation');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', jitsiUrl);
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
  });

  it('follows the provider that the API reports after a failover', async () => {
    const jitsiUrl = videoUrl('jitsi.example.test', '/room');
    page({ 'POST /appointments/a1/meeting': ok({ provider: 'jitsi', url: jitsiUrl }, 201) });
    await start();
    expect(await screen.findByTitle('Video consultation')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Google Meet/ })).not.toBeInTheDocument();
  });

  it('refuses an address that is not https', async () => {
    const { container } = page({ 'POST /appointments/a1/meeting': ok({ provider: 'jitsi', url: 'javascript:alert(1)' }, 201) });
    await start();
    expect(await screen.findByRole('alert')).toHaveTextContent('not safe to open');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows the API problem and lets the professional start again', async () => {
    page({ 'POST /appointments/a1/meeting': fail(503, 'video_not_configured', 'x') });
    await start();
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
    expect(screen.getByRole('button', { name: 'Start video meeting' })).toBeEnabled();
  });

  it('marks the start button busy while the meeting is created', async () => {
    page({ 'POST /appointments/a1/meeting': never });
    await start();
    const busy = await screen.findByRole('button', { name: 'Starting video meeting' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });

  it('gives a client and an administrator no start button', async () => {
    const first = page({}, 'client');
    await screen.findByRole('heading', { name: 'Appointment' });
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
    expect(await screen.findByText(/Your professional has not started the meeting yet/)).toBeInTheDocument();
    first.unmount();
    page({}, 'admin');
    await screen.findByRole('heading', { name: 'Appointment' });
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Video consultation' })).not.toBeInTheDocument();
  });

  it('asks for the stored meeting when the appointment opens, and shows it without a start button', async () => {
    const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7-stored');
    const { calls } = page({ 'GET /appointments/a1/meeting': ok({ provider: 'jitsi', url: jitsiUrl }) });
    const frame = await screen.findByTitle('Video consultation');
    expect(frame).toHaveAttribute('src', jitsiUrl);
    expect(screen.queryByRole('button', { name: 'Start video meeting' })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'GET' && call.path === '/appointments/a1/meeting')).toHaveLength(1);
  });

  it('lets the client join the room the professional started', async () => {
    const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7-stored');
    page({ 'GET /appointments/a1/meeting': ok({ provider: 'jitsi', url: jitsiUrl }) }, 'client');
    expect(await screen.findByTitle('Video consultation')).toHaveAttribute('src', jitsiUrl);
  });
});

describe('Chat', () => {
  const socket = () => FakeWebSocket.instances.at(-1);
  // ChatPanel creates the socket in an effect, which can run after the "Chat"
  // heading is already in the DOM. Wait for the socket itself, not the heading.
  const waitForSockets = (count) => waitFor(() => expect(FakeWebSocket.instances).toHaveLength(count));
  const frame = (ws, data) => act(() => ws.onmessage({ data: JSON.stringify(data) }));
  const message = (id, senderId, body) => ({ id, appointmentId: 'a1', senderId, body, sentAt: '2026-12-02T15:05:00.000Z' });

  const openChat = async (role = 'professional') => {
    page({}, role);
    await screen.findByRole('heading', { name: 'Chat' });
    await waitForSockets(1);
    const ws = socket();
    act(() => ws.onopen());
    return ws;
  };

  it('connects to /ws with the appointment id', async () => {
    const ws = await openChat();
    expect(ws.url).toMatch(/^wss?:\/\/[^/]+\/ws\?appointment=a1$/);
  });

  it('shows history and new messages in a polite live log, with Bogota times', async () => {
    const ws = await openChat();
    frame(ws, { type: 'history', items: [message('m1', 'u-luis', 'Hello from the client')] });
    const log = screen.getByRole('log', { name: 'Chat messages' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByText(/Hello from the client/)).toBeInTheDocument();
    expect(within(log).getByText(/10:05\sAM/)).toBeInTheDocument();
    frame(ws, { type: 'message', message: message('m2', 'u-ana', 'Reply from me') });
    expect(within(log).getByText(/Reply from me/)).toBeInTheDocument();
    expect(within(log).getByText(/^You, /)).toBeInTheDocument();
    frame(ws, { type: 'message', message: message('m2', 'u-ana', 'Reply from me') });
    expect(within(log).getAllByRole('listitem')).toHaveLength(2);
  });

  it('teaches the first step when there are no messages', async () => {
    await openChat();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it('sends a message as JSON text and clears the field', async () => {
    const ws = await openChat();
    await userEvent.type(screen.getByLabelText('Message'), 'See you soon');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'message', body: 'See you soon' });
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('refuses empty and oversized messages without sending', async () => {
    const ws = await openChat();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a message before sending.');
    await userEvent.click(screen.getByLabelText('Message'));
    await userEvent.paste('x'.repeat(2001));
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('alert')).toHaveTextContent('too long');
    expect(ws.sent).toHaveLength(0);
  });

  it('announces server errors in an alert', async () => {
    const ws = await openChat();
    frame(ws, { type: 'error', error: { code: 'message_too_large', message: 'x' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The message is too long');
  });

  it('disables sending until the connection is open', async () => {
    page();
    await screen.findByRole('heading', { name: 'Chat' });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Connecting to the chat.')).toHaveAttribute('role', 'status');
  });

  it('explains a closed appointment and offers no reconnect', async () => {
    const ws = await openChat();
    act(() => ws.onclose({ code: 4001 }));
    expect(screen.getByRole('status')).toHaveTextContent('This appointment is closed, so the chat has ended.');
    expect(screen.queryByRole('button', { name: 'Reconnect to chat' })).not.toBeInTheDocument();
  });

  it('offers a reconnect after a dropped connection', async () => {
    const ws = await openChat();
    act(() => ws.onclose({ code: 1006 }));
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect to chat' }));
    await waitForSockets(2);
  });

  it('closes the socket when the user leaves the page', async () => {
    const view = page();
    await screen.findByRole('heading', { name: 'Chat' });
    await waitForSockets(1);
    const ws = socket();
    view.unmount();
    expect(ws.closed).toBe(true);
  });

  it('does not open the chat for an administrator', async () => {
    page({}, 'admin');
    await screen.findByRole('heading', { name: 'Appointment' });
    expect(screen.queryByRole('heading', { name: 'Chat' })).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does not connect when the appointment is not scheduled', async () => {
    page({ 'GET /appointments/a1': ok(appointment({ status: 'cancelled' })) });
    expect(await screen.findByText(/The chat is closed because this appointment is cancelled/)).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('shows the messages as bubbles with initials, the own ones on the other side', async () => {
    const ws = await openChat();
    frame(ws, { type: 'history', items: [message('m1', 'u-luis', 'Hello from the client'), message('m2', 'u-ana', 'Reply from me')] });
    const [theirs, own] = within(screen.getByRole('log', { name: 'Chat messages' })).getAllByRole('listitem');
    expect(theirs).toHaveClass('chat-item');
    expect(theirs).not.toHaveClass('chat-item-own');
    expect(within(theirs).getByText('LU')).toHaveClass('avatar');
    expect(own).toHaveClass('chat-item-own');
    expect(within(own).getByText('AN')).toHaveClass('avatar');
  });

  it('marks the connection: connecting, connected, and closed', async () => {
    const { container } = page();
    await screen.findByRole('heading', { name: 'Chat' });
    const dot = () => container.querySelector('.chat-status-text').previousElementSibling;
    expect(dot()).toHaveClass('conn-connecting');
    await waitForSockets(1);
    act(() => socket().onopen());
    expect(dot()).toHaveClass('conn-open');
    act(() => socket().onclose({ code: 1006 }));
    expect(dot()).toHaveClass('conn-closed');
    expect(dot()).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the reconnect button beside the status of a dropped chat', async () => {
    const ws = await openChat();
    act(() => ws.onclose({ code: 1006 }));
    const status = screen.getByRole('status');
    expect(status.parentElement).toHaveClass('chat-status');
    expect(status.parentElement).toContainElement(screen.getByRole('button', { name: 'Reconnect to chat' }));
  });
});

describe('Appointment screen structure', () => {
  it('shows the participants with their initials, and the status as a chip', async () => {
    page();
    const head = (await screen.findByRole('heading', { name: 'Appointment' })).closest('header');
    expect(within(head).getByText('u-ana')).toBeInTheDocument();
    expect(within(head).getByText('u-luis')).toBeInTheDocument();
    expect(within(head).getByText('AN')).toBeInTheDocument();
    expect(within(head).getByText('LU')).toBeInTheDocument();
    expect(within(head).getByText('Scheduled')).toHaveClass('chip-teal');
    expect(within(head).getByText(/Dec 2, 2026, 5:50\sAM\sGMT-5/)).toBeInTheDocument();
  });

  it('puts the actions in the head', async () => {
    page();
    const head = (await screen.findByRole('heading', { name: 'Appointment' })).closest('header');
    expect(within(head).getByRole('link', { name: 'Back to appointments' })).toHaveAttribute('href', '/appointments');
    expect(within(head).getByRole('link', { name: 'Write consultation' })).toBeInTheDocument();
  });

  it('puts the video first and the chat after it, in one workspace', async () => {
    page();
    const video = await screen.findByRole('heading', { name: 'Video consultation' });
    const chat = await screen.findByRole('heading', { name: 'Chat' });
    const workspace = video.closest('.appt-workspace');
    expect(workspace).toContainElement(chat);
    expect(video.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the closed chat in the same place for an appointment that is not scheduled', async () => {
    page({ 'GET /appointments/a1': ok(appointment({ status: 'cancelled' })) });
    const head = (await screen.findByRole('heading', { name: 'Appointment' })).closest('header');
    expect(within(head).getByText('Cancelled')).toHaveClass('chip-neutral');
    const chat = await screen.findByRole('heading', { name: 'Chat' });
    expect(chat.closest('.appt-workspace')).not.toBeNull();
  });

  it('shows only the head to an administrator, without a video or a chat', async () => {
    const { container } = page({}, 'admin');
    await screen.findByRole('heading', { name: 'Appointment' });
    expect(container.querySelector('.appt-workspace')).toBeNull();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('shows a skeleton of its own shape while the appointment loads', async () => {
    const { container } = renderApp('/appointments/a1', { 'GET /appointments/a1': never });
    await screen.findByText('Loading');
    expect(container.querySelector('.skeleton-appointment')).not.toBeNull();
  });
});

describe('Video presentation', () => {
  const chips = (container) => [...container.querySelectorAll('.card-head-chips .chip')].map((chip) => chip.textContent);

  it('names the provider and the state of the room once the room is ready', async () => {
    const { container } = page({ 'GET /appointments/a1/meeting': ok({ provider: 'jitsi', url: videoUrl('jitsi.example.test', '/room') }) });
    await screen.findByTitle('Video consultation');
    expect(chips(container)).toEqual(['Jitsi', 'Room ready']);
  });

  it('names Google Meet when the API reports it', async () => {
    const { container } = page({ 'GET /appointments/a1/meeting': ok({ provider: 'meet', url: videoUrl('meet.example.test', '/abc') }) });
    await screen.findByRole('link', { name: 'Open Google Meet in a new tab' });
    expect(chips(container)).toEqual(['Google Meet', 'Room ready']);
  });

  it('says "Not started" to the professional and "Waiting" to the client', async () => {
    const first = page();
    await screen.findByRole('button', { name: 'Start video meeting' });
    expect(chips(first.container)).toEqual(['Not started']);
    first.unmount();
    const second = page({}, 'client');
    await screen.findByText(/Your professional has not started the meeting yet/);
    expect(chips(second.container)).toEqual(['Waiting']);
  });

  it('says "Problem" when the meeting cannot be read', async () => {
    const { container } = page({ 'GET /appointments/a1/meeting': fail(500, 'internal_error', 'x') });
    await screen.findByRole('alert');
    expect(chips(container)).toEqual(['Problem']);
  });

  it('puts the frame in a stage that keeps the 16:9 box, and the other states in the same stage', async () => {
    const { container } = page({ 'GET /appointments/a1/meeting': ok({ provider: 'jitsi', url: videoUrl('jitsi.example.test', '/room') }) });
    const frame = await screen.findByTitle('Video consultation');
    expect(frame).toHaveClass('video-frame');
    expect(frame.parentElement).toHaveClass('video-stage', 'is-live');
    expect(container.querySelectorAll('.video-stage')).toHaveLength(1);
  });

  it('shows the start button on the stage with the white button of dark surfaces', async () => {
    page();
    const button = await screen.findByRole('button', { name: 'Start video meeting' });
    expect(button).toHaveClass('btn-on-band');
    expect(button.closest('.video-stage')).not.toBeNull();
  });
});
