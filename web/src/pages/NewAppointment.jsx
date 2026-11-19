import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAppointment } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AlertIcon, CheckIcon } from '../components/icons.jsx';
import { Avatar, Button, Chip, FilterChip, PageHeader } from '../components/ui.jsx';
import { friendlyMessage } from '../lib/errors.js';
import { bogotaToUtcIso } from '../lib/format.js';
import { formatDayKey } from '../lib/schedule.js';
import { addMinutes, durationMinutes, formatClock } from '../lib/slots.js';

// The lengths that the chips offer, in minutes.
const DURATIONS = [30, 45, 50, 60, 90];
const NOT_SET = 'Not set yet';

function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p className="field-error" id={id}>
      <AlertIcon />
      {children}
    </p>
  );
}

function Person({ id, tone }) {
  if (!id.trim()) return NOT_SET;
  return (
    <span className="person">
      <Avatar name={id} size="sm" tone={tone} />
      <span className="person-id">{id.trim()}</span>
    </span>
  );
}

// The card that repeats what the user has typed, as it will be saved. It asks for nothing and
// calls no one, so it never shows an error of its own.
function Summary({ values }) {
  const length = durationMinutes(values.start, values.end);
  const missing = [];
  if (!values.professionalId.trim()) missing.push('professional ID');
  if (!values.clientId.trim()) missing.push('client ID');
  if (!values.date) missing.push('date');
  if (!values.start) missing.push('start time');
  if (!values.end) missing.push('end time');
  const ready = missing.length === 0 && length !== null;

  let time = NOT_SET;
  if (values.start && values.end) time = `${formatClock(values.start)} to ${formatClock(values.end)}`;
  else if (values.start) time = `From ${formatClock(values.start)}`;

  return (
    <aside className="card sched-summary" aria-labelledby="summary-title">
      <h2 id="summary-title">Summary</h2>
      <dl className="summary-list">
        <div className="summary-item">
          <dt>Professional</dt>
          <dd>
            <Person id={values.professionalId} tone="purple" />
          </dd>
        </div>
        <div className="summary-item">
          <dt>Client</dt>
          <dd>
            <Person id={values.clientId} tone="turquoise" />
          </dd>
        </div>
        <div className="summary-item">
          <dt>Date</dt>
          <dd>{values.date ? `${formatDayKey(values.date)}, ${values.date.slice(0, 4)}` : NOT_SET}</dd>
        </div>
        <div className="summary-item">
          <dt>Time</dt>
          <dd>{time}</dd>
        </div>
        <div className="summary-item">
          <dt>Duration</dt>
          <dd>{length === null ? NOT_SET : `${length} min`}</dd>
        </div>
      </dl>
      {ready ? (
        <Chip tone="teal" icon={CheckIcon}>
          Ready to create
        </Chip>
      ) : (
        <p className="hint summary-note">
          {missing.length > 0
            ? `Still needed: ${missing.join(', ')}.`
            : 'Check the times. The end has to come after the start.'}
        </p>
      )}
    </aside>
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

  // When the length is one of the chips, the end follows a new start.
  function changeStart(event) {
    const start = event.target.value;
    setValues((current) => {
      const kept = durationMinutes(current.start, current.end);
      const end = kept !== null && DURATIONS.includes(kept) ? addMinutes(start, kept) : null;
      return { ...current, start, end: end === null ? current.end : end };
    });
  }

  function pickDuration(minutes) {
    if (!values.start) {
      setErrors((current) => ({ ...current, start: 'Choose a start time first, then pick a duration.' }));
      return;
    }
    const end = addMinutes(values.start, minutes);
    if (end === null) {
      setErrors((current) => ({
        ...current,
        end: 'That duration ends after midnight. Pick a shorter one or an earlier start.',
      }));
      return;
    }
    setValues((current) => ({ ...current, end }));
    setErrors((current) => {
      const next = { ...current };
      delete next.end;
      delete next.start;
      return next;
    });
  }

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
  const length = durationMinutes(values.start, values.end);

  return (
    <>
      <PageHeader title="New appointment">
        <Button variant="secondary" to="/appointments">
          Back to appointments
        </Button>
      </PageHeader>
      <form className="sched" onSubmit={submit} noValidate aria-label="New appointment form">
        <div className="panel sched-fields">
          <p className="muted">Times are in Bogota time (America/Bogota).</p>

          <fieldset className="form-group">
            <legend>People</legend>
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
          </fieldset>

          <fieldset className="form-group">
            <legend>Date and time</legend>
            <div className="field">
              <label htmlFor="date">Date</label>
              <input
                id="date"
                className="input"
                type="date"
                value={values.date}
                onChange={change('date')}
                {...field('date')}
              />
              <FieldError id="date-error">{errors.date}</FieldError>
            </div>
            <div className="field-pair">
              <div className="field">
                <label htmlFor="start">Start time</label>
                <input
                  id="start"
                  className="input"
                  type="time"
                  value={values.start}
                  onChange={changeStart}
                  {...field('start')}
                />
                <FieldError id="start-error">{errors.start}</FieldError>
              </div>
              <div className="field">
                <label htmlFor="end">End time</label>
                <input
                  id="end"
                  className="input"
                  type="time"
                  value={values.end}
                  onChange={change('end')}
                  {...field('end')}
                />
                <FieldError id="end-error">{errors.end}</FieldError>
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="duration-label">
                Duration
              </span>
              <div className="chip-row" role="group" aria-labelledby="duration-label">
                {DURATIONS.map((minutes) => (
                  <FilterChip key={minutes} pressed={length === minutes} onClick={() => pickDuration(minutes)}>
                    {minutes} min
                  </FilterChip>
                ))}
              </div>
              <span className="hint">A duration sets the end time from the start time.</span>
            </div>
          </fieldset>
        </div>

        <Summary values={values} />

        <div className="sched-actions">
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
        </div>
      </form>
    </>
  );
}
