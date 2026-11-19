import { Link, useParams } from 'react-router-dom';
import { getAppointment } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import { FileIcon } from '../components/icons.jsx';
import { ErrorState, Loaded } from '../components/States.jsx';
import { Avatar, Button, StatusChip } from '../components/ui.jsx';
import VideoPanel from '../components/VideoPanel.jsx';
import { statusLabel } from '../lib/appointments.js';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

function Participant({ id, tone }) {
  return (
    <span className="person">
      <Avatar name={id} size="sm" tone={tone} />
      <span className="person-id">{id}</span>
    </span>
  );
}

export default function AppointmentPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const state = useLoad(() => getAppointment(id), [id]);
  const isProfessional = user.role === 'professional';
  const canChat = user.role === 'professional' || user.role === 'client';

  // A 404 is shown as a clear "not found" message instead of the generic error.
  if (state.status === 'error' && state.error.status === 404) {
    return (
      <section className="panel">
        <ErrorState error={state.error} title="Appointment not found" />
        <Link className="btn btn-secondary" to="/appointments">
          Back to appointments
        </Link>
      </section>
    );
  }

  return (
    <Loaded state={state} errorTitle="The appointment could not load" skeleton="appointment">
      {(appointment) => (
        <>
          <header className="appt-head">
            <div className="appt-head-top">
              <h1>Appointment</h1>
              <div className="actions">
                <Button variant="secondary" to="/appointments">
                  Back to appointments
                </Button>
                {isProfessional && (
                  <Button icon={FileIcon} to={`/appointments/${appointment.id}/consultation`}>
                    Write consultation
                  </Button>
                )}
              </div>
            </div>
            <dl className="appt-meta">
              <div className="appt-meta-item">
                <dt>Starts</dt>
                <dd>{formatDateTime(appointment.startsAt)}</dd>
              </div>
              <div className="appt-meta-item">
                <dt>Ends</dt>
                <dd>{formatDateTime(appointment.endsAt)}</dd>
              </div>
              <div className="appt-meta-item">
                <dt>Status</dt>
                <dd>
                  <StatusChip status={appointment.status}>{statusLabel(appointment.status)}</StatusChip>
                </dd>
              </div>
              <div className="appt-meta-item">
                <dt>Professional</dt>
                <dd>
                  <Participant id={appointment.professionalId} tone="purple" />
                </dd>
              </div>
              <div className="appt-meta-item">
                <dt>Client</dt>
                <dd>
                  <Participant id={appointment.clientId} tone="turquoise" />
                </dd>
              </div>
            </dl>
          </header>

          {canChat && (
            <div className="appt-workspace">
              <VideoPanel
                appointmentId={appointment.id}
                canStart={isProfessional}
                appointmentStatus={appointment.status}
              />
              {appointment.status === 'scheduled' ? (
                <ChatPanel appointmentId={appointment.id} userId={user.id} />
              ) : (
                <section className="card chat-card" aria-labelledby="chat-title">
                  <div className="card-head">
                    <h2 id="chat-title">Chat</h2>
                  </div>
                  <p>
                    The chat is closed because this appointment is {appointment.status}. Chat opens only for
                    scheduled appointments.
                  </p>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </Loaded>
  );
}
