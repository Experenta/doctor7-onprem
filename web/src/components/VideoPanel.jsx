import { useEffect, useRef, useState } from 'react';
import { createMeeting } from '../api/client.js';
import { friendlyMessage } from '../lib/errors.js';
import { safeVideoUrl } from '../lib/appointments.js';
import { getMeeting, MEETING_POLL_MS } from '../lib/meeting.js';
import { VideoIcon } from './icons.jsx';
import { Skeleton } from './States.jsx';

const UNSAFE_ADDRESS = 'The video address from the server is not safe to open. Reload the page and try again.';
const CLOSED_MESSAGE = 'This appointment is not scheduled, so a meeting cannot be started.';

const EMPTY = { status: 'empty', meeting: null, message: '', retry: null };

// The meeting the API returned, checked before it is opened or embedded.
function readyState(meeting) {
  const url = safeVideoUrl(meeting && meeting.url);
  const known = meeting && (meeting.provider === 'meet' || meeting.provider === 'jitsi');
  if (!url || !known) {
    return { status: 'error', meeting: null, message: UNSAFE_ADDRESS, retry: 'load' };
  }
  return { status: 'ready', meeting: { provider: meeting.provider, url }, message: '', retry: null };
}

// What a failed read means. A 404 is "no meeting yet": the page already loaded the
// appointment, so the appointment is readable.
function readFailed(error) {
  if (error && error.status === 404) return EMPTY;
  if (error && error.status === 403) return { status: 'forbidden', meeting: null, message: '', retry: null };
  return { status: 'error', meeting: null, message: friendlyMessage(error), retry: 'load' };
}

function startFailed(error) {
  const message = error && error.code === 'appointment_closed' ? CLOSED_MESSAGE : friendlyMessage(error);
  return { status: 'error', meeting: null, message, retry: 'start' };
}

// Shows the stored meeting of an appointment. The professional starts it, and the
// client waits for it: while the tab is visible, the panel asks again every 15 seconds.
// Meet opens in a new tab and is never embedded. Jitsi is embedded.
export default function VideoPanel({ appointmentId, canStart, appointmentStatus = 'scheduled' }) {
  const [state, setState] = useState({ status: 'loading', meeting: null, message: '', retry: null });
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const open = appointmentStatus === 'scheduled';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', meeting: null, message: '', retry: null });
    getMeeting(appointmentId).then(
      (meeting) => {
        if (active) setState(readyState(meeting));
      },
      (error) => {
        if (active) setState(readFailed(error));
      },
    );
    return () => {
      active = false;
    };
  }, [appointmentId, attempt]);

  // The client polls only while it waits. The interval ends when the meeting appears,
  // when the panel unmounts, or when the appointment is no longer scheduled.
  const waiting = !canStart && open && state.status === 'empty';
  useEffect(() => {
    if (!waiting) return undefined;
    let active = true;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const meeting = await getMeeting(appointmentId);
        if (active) setState(readyState(meeting));
      } catch (error) {
        // A 404 means the professional has not started yet. Any other failure is shown.
        if (active && !(error && error.status === 404)) setState(readFailed(error));
      } finally {
        busy = false;
      }
    }, MEETING_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [waiting, appointmentId]);

  async function start() {
    setState({ status: 'starting', meeting: null, message: '', retry: null });
    try {
      const meeting = await createMeeting(appointmentId);
      if (alive.current) setState(readyState(meeting));
    } catch (error) {
      if (alive.current) setState(startFailed(error));
    }
  }

  const { status, meeting, message, retry } = state;
  const showStart =
    canStart && open && (status === 'empty' || status === 'starting' || (status === 'error' && retry === 'start'));

  return (
    <section className="panel" aria-labelledby="video-title">
      <h2 id="video-title">Video consultation</h2>

      {status === 'loading' && <Skeleton label="Loading the video meeting" />}

      {status === 'forbidden' && (
        <p role="alert">Your account cannot open the video meeting of this appointment. Go back and pick another appointment.</p>
      )}

      {status === 'empty' && !open && <p className="muted">{CLOSED_MESSAGE}</p>}

      {status === 'empty' && open && !canStart && (
        <div role="status" aria-live="polite">
          <p>Your professional has not started the meeting yet.</p>
          <p className="muted">This page checks again every 15 seconds. Keep it open.</p>
        </div>
      )}

      {showStart && (
        <>
          <p>Start the meeting when you are ready. Your client opens the same appointment to join it.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={start}
            disabled={status === 'starting'}
            aria-busy={status === 'starting'}
          >
            <VideoIcon />
            {status === 'starting' ? 'Starting video meeting' : 'Start video meeting'}
          </button>
        </>
      )}

      {status === 'error' && (
        <div className="alert" role="alert">
          <p>{message}</p>
          {retry === 'load' && (
            <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          )}
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

      {status === 'ready' && meeting.provider === 'jitsi' && (
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
