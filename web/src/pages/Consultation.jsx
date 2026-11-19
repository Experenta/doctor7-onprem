import { Link, useParams } from 'react-router-dom';
import { getConsultation } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CheckIcon, LockIcon } from '../components/icons.jsx';
import { EmptyState, ErrorState, Loaded } from '../components/States.jsx';
import { Button, Chip, PageHeader } from '../components/ui.jsx';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

function humanize(key) {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export default function Consultation() {
  const { id } = useParams();
  const { user } = useAuth();
  const state = useLoad(() => getConsultation(id), [id]);
  // The professional writes the sheet. Every other role that may open it only reads it.
  const writer = user.role === 'professional';

  if (state.status === 'error' && state.error.status === 404) {
    return (
      <section className="panel">
        <ErrorState error={state.error} title="Consultation not found" />
        <Link className="btn btn-secondary" to="/appointments">
          Back to appointments
        </Link>
      </section>
    );
  }

  return (
    <Loaded
      state={state}
      errorTitle="The consultation could not load"
      isEmpty={(data) => !data.body || Object.keys(data.body).length === 0}
      empty={
        <section className="panel">
          <EmptyState title="This consultation has no notes">
            Nothing was recorded in this consultation. Open the appointment to write a new one.
          </EmptyState>
        </section>
      }
    >
      {(consultation) => (
        <>
          <PageHeader title="Consultation">
            <Button variant="secondary" to={`/appointments/${consultation.appointmentId}`}>
              Back to appointment
            </Button>
          </PageHeader>
          <section className="panel sheet" aria-labelledby="sheet-title">
            <div className="card-head">
              <h2 id="sheet-title">Consultation sheet</h2>
              {writer ? (
                <Chip tone="teal" icon={CheckIcon}>
                  Saved
                </Chip>
              ) : (
                <Chip tone="purple" icon={LockIcon}>
                  Read only
                </Chip>
              )}
            </div>
            <dl className="sheet-meta">
              <dt>Recorded</dt>
              <dd>{formatDateTime(consultation.createdAt)}</dd>
            </dl>
            {Object.entries(consultation.body).map(([key, value]) => (
              <div key={key} className="note-section">
                <h3>{humanize(key)}</h3>
                <p className="note-text">{renderValue(value)}</p>
              </div>
            ))}
            <p className="hint">Opening this sheet is recorded in the audit log.</p>
          </section>
        </>
      )}
    </Loaded>
  );
}
