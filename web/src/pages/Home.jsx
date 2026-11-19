import { Link } from 'react-router-dom';
import { listAppointments } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CalendarIcon, ClockIcon, PlusIcon, ShieldIcon } from '../components/icons.jsx';
import { Loaded } from '../components/States.jsx';
import { isInProgress, upcomingAppointments } from '../lib/appointments.js';
import { canAccess, roleLabel } from '../lib/access.js';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

function AppointmentSummary() {
  const state = useLoad(listAppointments, []);
  return (
    <Loaded state={state} errorTitle="Appointments could not load">
      {(data) => {
        const now = Date.now();
        const upcoming = upcomingAppointments(data.items, now);
        const next = upcoming[0];
        return (
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-tile stat-1">
                <CalendarIcon />
              </span>
              <div>
                <div className="stat-value">{upcoming.length}</div>
                <div className="muted">Upcoming appointments</div>
              </div>
            </div>
            <div className="stat">
              <span className="stat-tile stat-2">
                <ClockIcon />
              </span>
              <div>
                <div className="stat-value">{next ? formatDateTime(next.startsAt) : 'None scheduled'}</div>
                <div className="muted">
                  {next && isInProgress(next, now) ? (
                    <span className="now-marker">
                      <ClockIcon />
                      Happening now
                    </span>
                  ) : (
                    'Next appointment'
                  )}
                </div>
                {next && (
                  <Link to={`/appointments/${next.id}`}>Open next appointment</Link>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

export default function Home() {
  const { user } = useAuth();
  const role = user.role;

  return (
    <>
      <div className="page-head">
        <h1>Welcome, {user.displayName}</h1>
        <span className="badge">{roleLabel(role)}</span>
      </div>

      {canAccess(role, 'appointments') && <AppointmentSummary />}

      <section className="panel" aria-labelledby="actions-title">
        <h2 id="actions-title">What you can do</h2>
        {role === 'auditor' && <p>Review who read or changed records at your center.</p>}
        {role === 'client' && <p>See your appointments, join video, and chat with your professional.</p>}
        {role === 'professional' && <p>Schedule appointments, run video consultations, and write consultation notes.</p>}
        {role === 'admin' && <p>See every appointment of your center and schedule new ones.</p>}
        <div className="actions">
          {canAccess(role, 'appointments') && (
            <Link className="btn btn-secondary" to="/appointments">
              <CalendarIcon />
              View appointments
            </Link>
          )}
          {canAccess(role, 'newAppointment') && (
            <Link className="btn btn-primary" to="/appointments/new">
              <PlusIcon />
              Schedule an appointment
            </Link>
          )}
          {canAccess(role, 'audit') && (
            <Link className="btn btn-primary" to="/audit">
              <ShieldIcon />
              Open audit log
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
