import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createConsultation } from '../api/client.js';
import { AlertIcon } from '../components/icons.jsx';
import { friendlyMessage } from '../lib/errors.js';

export default function NewConsultation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitError('');
    if (!note.trim()) {
      setFieldError('Write the consultation note before saving.');
      return;
    }
    setFieldError('');
    setSaving(true);
    try {
      const created = await createConsultation({ appointmentId: id, body: { note: note.trim() } });
      navigate(`/consultations/${created.id}`);
    } catch (error) {
      setSubmitError(friendlyMessage(error));
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Write consultation</h1>
        <Link className="btn btn-secondary" to={`/appointments/${id}`}>
          Back to appointment
        </Link>
      </div>
      <section className="panel" aria-label="Consultation form">
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="note">Consultation note</label>
            <textarea
              id="note"
              className="textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? 'note-error' : undefined}
            />
            {fieldError && (
              <p className="field-error" id="note-error">
                <AlertIcon />
                {fieldError}
              </p>
            )}
          </div>
          {submitError && (
            <div className="alert" role="alert">
              <AlertIcon />
              <p>{submitError}</p>
            </div>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>
              {saving ? 'Saving consultation' : 'Save consultation'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
