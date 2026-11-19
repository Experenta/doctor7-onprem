import { useState } from 'react';
import { listAudit } from '../api/client.js';
import { EmptyState, Loaded } from '../components/States.jsx';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

const NONE = { outcome: '', action: '', actorId: '' };

function target(entry) {
  if (!entry.targetType && !entry.targetId) return 'n/a';
  return [entry.targetType, entry.targetId].filter(Boolean).join(' ');
}

export default function Audit() {
  const [draft, setDraft] = useState(NONE);
  const [applied, setApplied] = useState(NONE);
  const state = useLoad(
    () => listAudit(applied),
    [applied.outcome, applied.action, applied.actorId],
  );

  const change = (name) => (event) => setDraft((current) => ({ ...current, [name]: event.target.value }));

  function apply(event) {
    event.preventDefault();
    setApplied({ ...draft, action: draft.action.trim(), actorId: draft.actorId.trim() });
  }

  function clear() {
    setDraft(NONE);
    setApplied(NONE);
  }

  return (
    <>
      <div className="page-head">
        <h1>Audit log</h1>
      </div>

      <section className="panel" aria-label="Audit filters">
        <form className="filters" onSubmit={apply}>
          <div className="field">
            <label htmlFor="outcome">Outcome</label>
            <select id="outcome" className="select" value={draft.outcome} onChange={change('outcome')}>
              <option value="">All outcomes</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failure">Failure</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="action">Action</label>
            <input
              id="action"
              className="input"
              value={draft.action}
              onChange={change('action')}
              placeholder="consultation.read"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="actorId">Actor ID</label>
            <input
              id="actorId"
              className="input"
              value={draft.actorId}
              onChange={change('actorId')}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
        </form>
      </section>

      <section className="panel" aria-label="Audit entries">
        <Loaded
          state={state}
          errorTitle="The audit log could not load"
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              title="No audit entries match"
              action={
                <button type="button" className="btn btn-secondary" onClick={clear}>
                  Clear filters
                </button>
              }
            >
              Clear the filters, or use a wider action or actor, to see more entries.
            </EmptyState>
          }
        >
          {(data) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Reason</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Time">{formatDateTime(entry.occurredAt)}</td>
                      <td data-label="Actor" className="cell-break">{entry.actorId || 'n/a'}</td>
                      <td data-label="Action" className="cell-break">{entry.action}</td>
                      <td data-label="Target" className="cell-break">{target(entry)}</td>
                      <td data-label="Outcome">
                        <span
                          className={
                            entry.outcome === 'success'
                              ? 'badge badge-success'
                              : entry.outcome === 'denied' || entry.outcome === 'failure'
                                ? 'badge badge-danger'
                                : 'badge'
                          }
                        >
                          {entry.outcome}
                        </span>
                      </td>
                      <td data-label="Reason" className="cell-break">{entry.reason || 'n/a'}</td>
                      <td data-label="IP">{entry.ip || 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </section>
    </>
  );
}
