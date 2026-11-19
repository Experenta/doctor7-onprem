import { useEffect, useRef, useState } from 'react';
import { listAudit } from '../api/client.js';
import { AlertIcon, BanIcon, CheckIcon, CloseIcon, SearchIcon } from '../components/icons.jsx';
import { EmptyState, Loaded } from '../components/States.jsx';
import { Button, Chip, FilterChip, PageHeader } from '../components/ui.jsx';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

const NO_TEXT = { action: '', actorId: '' };
const OUTCOMES = [
  { value: '', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'failure', label: 'Failure' },
];
// The API sends the newest 100 entries of the center.
const PAGE_SIZE = 100;

// Tone and icon of each outcome. The word is always shown, so color is never the only cue.
const OUTCOME_LOOK = {
  success: { tone: 'teal', icon: CheckIcon },
  denied: { tone: 'magenta', icon: BanIcon },
  failure: { tone: 'magenta', icon: AlertIcon },
};

function target(entry) {
  if (!entry.targetType && !entry.targetId) return 'n/a';
  return [entry.targetType, entry.targetId].filter(Boolean).join(' ');
}

function OutcomeChip({ outcome }) {
  const look = OUTCOME_LOOK[outcome] || { tone: 'neutral', icon: null };
  return (
    <Chip tone={look.tone} icon={look.icon}>
      {outcome}
    </Chip>
  );
}

// Every field of one entry. The audit log holds no clinical text, so this panel has none.
function Detail({ entry, headingRef, onClose }) {
  return (
    <aside
      className="card audit-detail"
      aria-labelledby="audit-detail-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="card-head">
        <h2 id="audit-detail-title" tabIndex={-1} ref={headingRef}>
          Entry details
        </h2>
        <button type="button" className="btn btn-ghost icon-btn" onClick={onClose}>
          <CloseIcon />
          <span className="sr-only">Close details</span>
        </button>
      </div>
      <dl className="details audit-fields">
        <dt>Time</dt>
        <dd>{formatDateTime(entry.occurredAt)}</dd>
        <dt>Actor</dt>
        <dd>{entry.actorId || 'n/a'}</dd>
        <dt>Action</dt>
        <dd>{entry.action}</dd>
        <dt>Target</dt>
        <dd>{target(entry)}</dd>
        <dt>Outcome</dt>
        <dd>
          <OutcomeChip outcome={entry.outcome} />
        </dd>
        <dt>Reason</dt>
        <dd>{entry.reason || 'n/a'}</dd>
        <dt>IP</dt>
        <dd>{entry.ip || 'n/a'}</dd>
        <dt>Entry</dt>
        <dd>{entry.id}</dd>
      </dl>
      <p className="hint">Audit entries record who did what. They hold no clinical text.</p>
    </aside>
  );
}

export default function Audit() {
  const [outcome, setOutcome] = useState('');
  const [draft, setDraft] = useState(NO_TEXT);
  const [applied, setApplied] = useState(NO_TEXT);
  const [selectedId, setSelectedId] = useState(null);
  const headingRef = useRef(null);
  const openers = useRef(new Map());

  const state = useLoad(
    () => listAudit({ outcome, ...applied }),
    [outcome, applied.action, applied.actorId],
  );

  const items = state.status === 'ready' ? state.data.items : [];
  const selected = items.find((entry) => entry.id === selectedId) || null;
  const filtersActive = outcome !== '' || applied.action !== '' || applied.actorId !== '';

  // When a detail opens, the focus goes to its heading, which also scrolls it into view.
  useEffect(() => {
    if (selected && headingRef.current) headingRef.current.focus();
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (name) => (event) => setDraft((current) => ({ ...current, [name]: event.target.value }));

  function apply(event) {
    event.preventDefault();
    setApplied({ action: draft.action.trim(), actorId: draft.actorId.trim() });
  }

  function clear() {
    setOutcome('');
    setDraft(NO_TEXT);
    setApplied(NO_TEXT);
    setSelectedId(null);
  }

  function closeDetail() {
    const opener = openers.current.get(selectedId);
    setSelectedId(null);
    if (opener) opener.focus();
  }

  const remember = (id) => (node) => {
    if (node) openers.current.set(id, node);
    else openers.current.delete(id);
  };

  return (
    <>
      <PageHeader title="Audit log" />

      <section className="panel audit-filters" aria-label="Audit filters">
        <div className="chip-row" role="group" aria-label="Outcome">
          {OUTCOMES.map((option) => (
            <FilterChip key={option.value} pressed={outcome === option.value} onClick={() => setOutcome(option.value)}>
              {option.label}
            </FilterChip>
          ))}
        </div>
        <form className="audit-search" role="search" aria-label="Search the audit log" onSubmit={apply}>
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
          <div className="actions">
            <Button type="submit" icon={SearchIcon}>
              Apply filters
            </Button>
            {filtersActive && !(state.status === 'ready' && items.length === 0) && (
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
        </form>
      </section>

      <div className={selected ? 'audit-layout has-detail' : 'audit-layout'}>
        <section className="panel audit-results" aria-label="Audit entries">
          <Loaded
            state={state}
            errorTitle="The audit log could not load"
            skeleton="list"
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="No audit entries match"
                action={
                  <Button variant="secondary" onClick={clear}>
                    Clear filters
                  </Button>
                }
              >
                Clear the filters, or use a wider action or actor, to see more entries.
              </EmptyState>
            }
          >
            {(data) => (
              <>
                <p className="hint audit-count">
                  {data.items.length} {data.items.length === 1 ? 'entry' : 'entries'}
                  {data.items.length >= PAGE_SIZE ? '. These are the newest. Use the filters to find older ones.' : '.'}
                </p>
                <div className="table-wrap table-scroll">
                  <table className="table table-dense audit-table">
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
                        <tr
                          key={entry.id}
                          className={entry.id === selectedId ? 'is-selected' : undefined}
                          onClick={() => setSelectedId(entry.id)}
                        >
                          <td data-label="Time">{formatDateTime(entry.occurredAt)}</td>
                          <td data-label="Actor" className="cell-break">{entry.actorId || 'n/a'}</td>
                          <td data-label="Action" className="cell-break">
                            <button
                              type="button"
                              className="row-open"
                              ref={remember(entry.id)}
                              aria-expanded={entry.id === selectedId}
                            >
                              {entry.action}
                              <span className="sr-only">, show details</span>
                            </button>
                          </td>
                          <td data-label="Target" className="cell-break">{target(entry)}</td>
                          <td data-label="Outcome">
                            <OutcomeChip outcome={entry.outcome} />
                          </td>
                          <td data-label="Reason" className="cell-break">{entry.reason || 'n/a'}</td>
                          <td data-label="IP">{entry.ip || 'n/a'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Loaded>
        </section>
        {selected && <Detail entry={selected} headingRef={headingRef} onClose={closeDetail} />}
      </div>
    </>
  );
}
