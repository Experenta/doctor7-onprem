import { Link, useParams } from 'react-router-dom';
import { getAppointment } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import { FileIcon } from '../components/icons.jsx';
import { ErrorState, Loaded } from '../components/States.jsx';
import VideoPanel from '../components/VideoPanel.jsx';
import { statusLabel } from '../lib/appointments.js';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

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
    <Loaded state={state} errorTitle="The appointment could not load">
      {(appointment) => (
        <>
          <div className="page-head">
            <h1>Appointment</h1>
            <div className="actions">
              <Link className="btn btn-secondary" to="/appointments">
                Back to appointments
              </Link>
              {isProfessional && (
                <Link className="btn btn-primary" to={`/appointments/${appointment.id}/consultation`}>
                  <FileIcon />
                  Write consultation
                </Link>
              )}
            </div>
          </div>

          <section className="panel" aria-labelledby="details-title">
            <h2 id="details-title">Details</h2>
            <dl className="details">
              <dt>Starts</dt>
              <dd>{formatDateTime(appointment.startsAt)}</dd>
              <dt>Ends</dt>
              <dd>{formatDateTime(appointment.endsAt)}</dd>
              <dt>Status</dt>
              <dd>
                <span className="badge">{statusLabel(appointment.status)}</span>
              </dd>
              <dt>Professional</dt>
              <dd>{appointment.professionalId}</dd>
              <dt>Client</dt>
              <dd>{appointment.clientId}</dd>
            </dl>
          </section>

          {(isProfessional || user.role === 'client') && (
            <VideoPanel appointmentId={appointment.id} canStart={isProfessional} appointmentStatus={appointment.status} />
          )}

          {canChat && appointment.status === 'scheduled' && (
            <ChatPanel appointmentId={appointment.id} userId={user.id} />
          )}
          {canChat && appointment.status !== 'scheduled' && (
            <section className="panel" aria-labelledby="chat-title">
              <h2 id="chat-title">Chat</h2>
              <p>
                The chat is closed because this appointment is {appointment.status}. Chat opens only for
                scheduled appointments.
              </p>
            </section>
          )}
        </>
      )}
    </Loaded>
  );
}
