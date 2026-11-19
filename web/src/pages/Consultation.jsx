import { Link, useParams } from 'react-router-dom';
import { getConsultation } from '../api/client.js';
import { EmptyState, ErrorState, Loaded } from '../components/States.jsx';
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
  const state = useLoad(() => getConsultation(id), [id]);

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
          <div className="page-head">
            <h1>Consultation</h1>
            <Link className="btn btn-secondary" to={`/appointments/${consultation.appointmentId}`}>
              Back to appointment
            </Link>
          </div>
          <section className="panel" aria-labelledby="sheet-title">
            <h2 id="sheet-title">Consultation sheet</h2>
            <dl className="details">
              <dt>Recorded</dt>
              <dd>{formatDateTime(consultation.createdAt)}</dd>
              {Object.entries(consultation.body).map(([key, value]) => (
                <div key={key} className="details-group">
                  <dt>{humanize(key)}</dt>
                  <dd className="pre-wrap">{renderValue(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="hint">Opening this sheet is recorded in the audit log.</p>
          </section>
        </>
      )}
    </Loaded>
  );
}
