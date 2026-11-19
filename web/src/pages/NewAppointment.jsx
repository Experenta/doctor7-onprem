import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createAppointment } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AlertIcon } from '../components/icons.jsx';
import { friendlyMessage } from '../lib/errors.js';
import { bogotaToUtcIso } from '../lib/format.js';

function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p className="field-error" id={id}>
      <AlertIcon />
      {children}
    </p>
  );
}

export default function NewAppointment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isProfessional = user.role === 'professional';

  const [values, setValues] = useState({
    professionalId: isProfessional ? user.id : '',
    clientId: '',
    date: '',
    start: '',
    end: '',
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  const change = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const found = {};
    if (!values.professionalId.trim()) found.professionalId = 'Enter the professional ID.';
    if (!values.clientId.trim()) found.clientId = 'Enter the client ID.';
    if (!values.date) found.date = 'Choose a date.';
    if (!values.start) found.start = 'Choose a start time.';
    if (!values.end) found.end = 'Choose an end time.';

    const startsAt = bogotaToUtcIso(values.date, values.start);
    const endsAt = bogotaToUtcIso(values.date, values.end);
    if (startsAt && endsAt && endsAt <= startsAt) {
      found.end = 'The end time must be after the start time. Pick a later end time.';
    }

    setErrors(found);
    setSubmitError('');
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const created = await createAppointment({
        professionalId: values.professionalId.trim(),
        clientId: values.clientId.trim(),
        startsAt,
        endsAt,
      });
      navigate(`/appointments/${created.id}`);
    } catch (error) {
      setSubmitError(friendlyMessage(error));
      setSaving(false);
    }
  }

  const field = (name) => ({
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });

  return (
    <>
      <div className="page-head">
        <h1>New appointment</h1>
        <Link className="btn btn-secondary" to="/appointments">
          Back to appointments
        </Link>
      </div>
      <section className="panel" aria-label="New appointment form">
        <p className="muted">Times are in Bogota time (America/Bogota).</p>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="professionalId">Professional ID</label>
            <input
              id="professionalId"
              className="input"
              value={values.professionalId}
              onChange={change('professionalId')}
              readOnly={isProfessional}
              autoComplete="off"
              {...field('professionalId')}
            />
            {isProfessional && <span className="hint">Appointments you create are always for you.</span>}
            <FieldError id="professionalId-error">{errors.professionalId}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="clientId">Client ID</label>
            <input
              id="clientId"
              className="input"
              value={values.clientId}
              onChange={change('clientId')}
              autoComplete="off"
              {...field('clientId')}
            />
            <FieldError id="clientId-error">{errors.clientId}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" className="input" type="date" value={values.date} onChange={change('date')} {...field('date')} />
            <FieldError id="date-error">{errors.date}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="start">Start time</label>
            <input id="start" className="input" type="time" value={values.start} onChange={change('start')} {...field('start')} />
            <FieldError id="start-error">{errors.start}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="end">End time</label>
            <input id="end" className="input" type="time" value={values.end} onChange={change('end')} {...field('end')} />
            <FieldError id="end-error">{errors.end}</FieldError>
          </div>

          {submitError && (
            <div className="alert" role="alert">
              <AlertIcon />
              <p>{submitError}</p>
            </div>
          )}

          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>
              {saving ? 'Creating appointment' : 'Create appointment'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
