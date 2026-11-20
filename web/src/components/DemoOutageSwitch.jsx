import { useEffect, useRef, useState } from 'react';
import { getMeetOutage, setMeetOutage } from '../api/client.js';
import { friendlyMessage } from '../lib/errors.js';
import { CheckIcon, VideoIcon } from './icons.jsx';
import { Button, Card, Chip, InlineAlert } from './ui.jsx';

const TITLE = 'Demo only: simulate a Google Meet outage';

// What the administrator sees after a change, so the result is clear without the status line.
const CONFIRMATION = {
  on: 'Outage turned on. The next meeting a professional starts is created in Jitsi.',
  off: 'Outage turned off. The next meeting a professional starts is created in Google Meet.',
};

// The simulator is a separate service on the demo host. Say which one, and what to do.
function problemText(error) {
  if (error && error.code === 'demo_simulator_unavailable') {
    return 'The Google Meet simulator did not answer. Check that the service doctor7-mock-google is running on the demo host, then try again.';
  }
  return friendlyMessage(error);
}

// The demo-only switch of the administrator Home. It asks the API for its state first. The
// API answers only when it runs in demo mode, and every other answer shows nothing, with one
// exception: a demo server whose simulator does not answer (code demo_simulator_unavailable)
// shows the switch with the problem, so the administrator can see what to fix.
export default function DemoOutageSwitch() {
  const [state, setState] = useState({ status: 'loading', outage: false, error: null });
  const [change, setChange] = useState({ busy: false, error: '', confirmation: '' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function load() {
    setState((current) => ({ ...current, status: 'loading' }));
    getMeetOutage().then(
      (data) => {
        if (alive.current) setState({ status: 'ready', outage: data && data.meetOutage === true, error: null });
      },
      (error) => {
        if (!alive.current) return;
        const shown = error && error.code === 'demo_simulator_unavailable';
        setState({ status: shown ? 'problem' : 'hidden', outage: false, error });
      },
    );
  }

  useEffect(load, []);

  async function toggle() {
    const wanted = !state.outage;
    setChange({ busy: true, error: '', confirmation: '' });
    try {
      const data = await setMeetOutage(wanted);
      if (!alive.current) return;
      const outage = data && data.meetOutage === true;
      setState({ status: 'ready', outage, error: null });
      setChange({ busy: false, error: '', confirmation: outage ? CONFIRMATION.on : CONFIRMATION.off });
    } catch (error) {
      if (alive.current) setChange({ busy: false, error: problemText(error), confirmation: '' });
    }
  }

  if (state.status === 'loading' || state.status === 'hidden') return null;

  const { outage } = state;
  return (
    <Card as="section" aria-labelledby="demo-outage-title">
      <div className="card-head">
        <h2 id="demo-outage-title">{TITLE}</h2>
        {state.status === 'ready' && (
          <Chip tone={outage ? 'purple' : 'neutral'} icon={VideoIcon}>
            {outage ? 'Outage on' : 'Outage off'}
          </Chip>
        )}
      </div>
      <p className="muted">
        Turn this on, then ask a professional to start a video meeting. Google Meet does not answer, so the
        meeting is created in Jitsi and the appointment says so. Turn it off to go back to Google Meet. A
        meeting that already exists does not change.
      </p>
      {state.status === 'problem' && <InlineAlert onRetry={load}>{problemText(state.error)}</InlineAlert>}
      {state.status === 'ready' && (
        <Button
          variant={outage ? 'primary' : 'secondary'}
          icon={VideoIcon}
          role="switch"
          aria-checked={outage}
          aria-busy={change.busy}
          disabled={change.busy}
          onClick={toggle}
        >
          Simulate a Google Meet outage
        </Button>
      )}
      <div role="status" aria-live="polite">
        {change.confirmation && (
          <p className="room room-ready">
            <CheckIcon />
            {change.confirmation}
          </p>
        )}
      </div>
      {change.error && <InlineAlert>{change.error}</InlineAlert>}
    </Card>
  );
}
