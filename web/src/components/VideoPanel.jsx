import { useState } from 'react';
import { createMeeting } from '../api/client.js';
import { friendlyMessage } from '../lib/errors.js';
import { safeVideoUrl } from '../lib/appointments.js';
import { VideoIcon } from './icons.jsx';

// The professional starts the meeting. Meet opens in a new tab and is never
// embedded. Jitsi is embedded.
export default function VideoPanel({ appointmentId, canStart }) {
  const [state, setState] = useState({ status: 'idle', meeting: null, message: '' });

  async function start() {
    setState({ status: 'loading', meeting: null, message: '' });
    try {
      const meeting = await createMeeting(appointmentId);
      const url = safeVideoUrl(meeting.url);
      if (!url) {
        setState({
          status: 'error',
          meeting: null,
          message: 'The video address from the server is not safe to open. Try starting the meeting again.',
        });
        return;
      }
      setState({ status: 'ready', meeting: { provider: meeting.provider, url }, message: '' });
    } catch (error) {
      setState({ status: 'error', meeting: null, message: friendlyMessage(error) });
    }
  }

  const { status, meeting, message } = state;

  return (
    <section className="panel" aria-labelledby="video-title">
      <h2 id="video-title">Video consultation</h2>

      {!canStart && (
        <p className="muted">The professional of this appointment starts the video meeting.</p>
      )}

      {canStart && status !== 'ready' && (
        <>
          <p>Start the meeting when you are ready. The provider is set by your clinic.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={start}
            disabled={status === 'loading'}
            aria-busy={status === 'loading'}
          >
            <VideoIcon />
            {status === 'loading' ? 'Starting video meeting' : 'Start video meeting'}
          </button>
        </>
      )}

      {status === 'error' && (
        <div className="alert" role="alert">
          <p>{message}</p>
        </div>
      )}

      {status === 'ready' && meeting.provider === 'meet' && (
        <>
          <p>The meeting is ready. Google Meet opens in a new tab.</p>
          <a className="btn btn-primary" href={meeting.url} target="_blank" rel="noopener noreferrer">
            <VideoIcon />
            Open Google Meet in a new tab
          </a>
        </>
      )}

      {status === 'ready' && meeting.provider !== 'meet' && (
        <iframe
          className="video-frame"
          title="Video consultation"
          src={meeting.url}
          allow="camera; microphone; fullscreen; display-capture"
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  );
}
