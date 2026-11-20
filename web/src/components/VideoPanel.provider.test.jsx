import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VideoPanel, { FALLBACK_NOTICE, providerLabel } from './VideoPanel.jsx';
import { mockApi, ok, videoUrl } from '../test/helpers.jsx';

const GET_MEETING = 'GET /appointments/a1/meeting';
const jitsiUrl = videoUrl('jitsi.example.test', '/doctor7room');
const meetUrl = videoUrl('meet.example.test', '/abc-defg-hij');

async function panel(meeting) {
  mockApi({ [GET_MEETING]: ok(meeting) });
  const view = render(<VideoPanel appointmentId="a1" canStart={false} />);
  await screen.findByText('Room ready');
  return view;
}

describe('the provider chip', () => {
  it('says Google Meet (simulated) for a Meet meeting of the demo', async () => {
    await panel({ provider: 'meet', url: meetUrl, fallback: false, simulated: true });
    expect(screen.getByText('Google Meet (simulated)')).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument();
  });

  it('says Google Meet, without "simulated", when the API does not say it is a simulator', async () => {
    await panel({ provider: 'meet', url: meetUrl, fallback: false, simulated: false });
    expect(screen.getByText('Google Meet')).toBeInTheDocument();
    expect(screen.queryByText(/simulated/)).not.toBeInTheDocument();
  });

  it('says Jitsi (fallback) and shows the notice when Jitsi took over from Meet', async () => {
    await panel({ provider: 'jitsi', url: jitsiUrl, fallback: true, simulated: false });
    expect(screen.getByText('Jitsi (fallback)')).toBeInTheDocument();
    const notice = screen.getByText('Google Meet was not available, so this meeting was created in Jitsi.');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute('role', 'status');
  });

  it('says only Jitsi, with no notice, for a meeting that was not a failover', async () => {
    await panel({ provider: 'jitsi', url: jitsiUrl, fallback: false, simulated: false });
    expect(screen.getByText('Jitsi')).toBeInTheDocument();
    expect(screen.queryByText(/fallback/)).not.toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument();
  });

  it('treats a meeting stored before the flags existed as a plain one', async () => {
    await panel({ provider: 'jitsi', url: jitsiUrl });
    expect(screen.getByText('Jitsi')).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument();
  });

  it('reads only a real true, so a text value does not turn the notice on', async () => {
    await panel({ provider: 'jitsi', url: jitsiUrl, fallback: 'true', simulated: 'true' });
    expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByText('Jitsi')).toBeInTheDocument();
  });

  it('builds the label from the flags', () => {
    expect(providerLabel({ provider: 'meet', simulated: true })).toBe('Google Meet (simulated)');
    expect(providerLabel({ provider: 'meet', simulated: false })).toBe('Google Meet');
    expect(providerLabel({ provider: 'jitsi', fallback: true })).toBe('Jitsi (fallback)');
    expect(providerLabel({ provider: 'jitsi', fallback: false })).toBe('Jitsi');
  });
});

describe('the Meet link of the demo', () => {
  it('still opens in a new tab and is never embedded', async () => {
    const { container } = await panel({ provider: 'meet', url: meetUrl, fallback: false, simulated: true });
    const link = screen.getByRole('link', { name: 'Open Google Meet in a new tab' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
