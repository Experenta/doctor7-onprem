import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createConsultation } from '../api/client.js';
import { AlertIcon, CheckIcon, ClockIcon } from '../components/icons.jsx';
import { Button, Chip, PageHeader } from '../components/ui.jsx';
import { friendlyMessage } from '../lib/errors.js';

// What the save indicator says. It is derived from the screen state, so it adds no state of
// its own. There is no draft endpoint, so nothing is saved until the button is pressed.
function indicatorFor({ saving, submitError, note }) {
  if (saving) return { tone: 'purple', icon: ClockIcon, label: 'Saving' };
  if (submitError) return { tone: 'magenta', icon: AlertIcon, label: 'Not saved' };
  if (note.trim()) return { tone: 'neutral', icon: null, label: 'Not saved yet' };
  return { tone: 'neutral', icon: null, label: 'Nothing written yet' };
}

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

  const indicator = indicatorFor({ saving, submitError, note });

  return (
    <>
      <PageHeader title="Write consultation">
        <Button variant="secondary" to={`/appointments/${id}`}>
          Back to appointment
        </Button>
      </PageHeader>
      <form className="editor" onSubmit={submit} noValidate aria-label="Consultation form">
        <div className="panel">
          <div className="card-head">
            <h2>Note</h2>
            <span role="status">
              <Chip tone={indicator.tone} icon={indicator.icon}>
                {indicator.label}
              </Chip>
            </span>
          </div>
          <div className="field">
            <label htmlFor="note">Consultation note</label>
            <textarea
              id="note"
              className="textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? 'note-error note-count' : 'note-count'}
            />
            <div className="editor-foot">
              {fieldError ? (
                <p className="field-error" id="note-error">
                  <AlertIcon />
                  {fieldError}
                </p>
              ) : (
                <span />
              )}
              <span className="hint char-count" id="note-count">
                {note.length} {note.length === 1 ? 'character' : 'characters'}
              </span>
            </div>
          </div>
        </div>
        {submitError && (
          <div className="alert" role="alert">
            <AlertIcon />
            <p>{submitError}</p>
          </div>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>
            <CheckIcon />
            {saving ? 'Saving consultation' : 'Save consultation'}
          </button>
        </div>
      </form>
    </>
  );
}
