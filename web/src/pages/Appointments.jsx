import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listAppointments } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ArrowLeftIcon, ArrowRightIcon, ListIcon, PlusIcon, WeekIcon } from '../components/icons.jsx';
import { EmptyState, Loaded } from '../components/States.jsx';
import { Avatar, Button, FilterChip, PageHeader, Segmented, StatusChip } from '../components/ui.jsx';
import { canAccess } from '../lib/access.js';
import { statusLabel } from '../lib/appointments.js';
import { formatDateTime, formatTime } from '../lib/format.js';
import {
  addDays,
  dayKey,
  dayNumber,
  formatWeekRange,
  groupByDay,
  matchesFilter,
  onDay,
  weekDays,
  weekdayShort,
} from '../lib/schedule.js';
import { useLoad } from '../lib/useLoad.js';
import { useNow } from '../lib/useNow.js';

const VIEWS = [
  { value: 'list', label: 'List', icon: ListIcon },
  { value: 'week', label: 'Week', icon: WeekIcon },
];
const COLUMNS = 6;

// The signed-in person is shown by name. Everyone else keeps the identifier.
function useShownName(id) {
  const { user } = useAuth();
  return id === user.id ? user.displayName : id;
}

// Renders the name of the signed-in person, or the identifier of anyone else.
function ShownName({ id }) {
  return useShownName(id);
}

function Person({ id }) {
  const text = useShownName(id);
  return (
    <span className="person">
      <Avatar name={text} size="sm" />
      <span className="person-id" title={text}>
        {text}
      </span>
    </span>
  );
}

// A time of day for the eye, and the full date and time for assistive technology.
function Moment({ iso }) {
  return (
    <>
      <span aria-hidden="true">{formatTime(iso)}</span>
      <span className="sr-only">{formatDateTime(iso)}</span>
    </>
  );
}

function AppointmentTable({ groups }) {
  return (
    <div className="table-wrap">
      <table className="table appt-table">
        <thead>
          <tr>
            <th scope="col">Starts</th>
            <th scope="col">Ends</th>
            <th scope="col">Status</th>
            <th scope="col">Professional</th>
            <th scope="col">Client</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group, index) => (
          <GroupRows key={group.key} group={group} previous={groups[index - 1]} />
        ))}
      </table>
    </div>
  );
}

function GroupRows({ group, previous }) {
  const startsEarlier = group.section === 'earlier' && previous && previous.section === 'upcoming';
  return (
    <>
      {startsEarlier && (
        <tbody className="section-divider">
          <tr>
            <th scope="rowgroup" colSpan={COLUMNS}>
              Earlier
            </th>
          </tr>
        </tbody>
      )}
      <tbody className="day-group">
        <tr className="day-row">
          <th scope="rowgroup" colSpan={COLUMNS}>
            {group.label}
          </th>
        </tr>
        {group.items.map((item) => (
          <tr key={item.id} className={`appt-row appt-row-${item.status}`}>
            <td data-label="Starts" className="cell-start">
              <Link className="appt-time" to={`/appointments/${item.id}`}>
                <Moment iso={item.startsAt} />
              </Link>
            </td>
            <td data-label="Ends" className="cell-end">
              <Moment iso={item.endsAt} />
            </td>
            <td data-label="Status">
              <StatusChip status={item.status}>{statusLabel(item.status)}</StatusChip>
            </td>
            <td data-label="Professional" className="cell-break">
              <Person id={item.professionalId} />
            </td>
            <td data-label="Client" className="cell-break">
              <Person id={item.clientId} />
            </td>
            <td data-label="Actions" className="cell-actions">
              <Link
                className="quick-action"
                to={`/appointments/${item.id}`}
                aria-label={`Open the appointment at ${formatTime(item.startsAt)}`}
              >
                Open
                <ArrowRightIcon />
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function WeekView({ items, todayKey }) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(addDays(todayKey, offset * 7));

  return (
    <div className="week-view">
      <div className="week-nav">
        <Button variant="secondary" icon={ArrowLeftIcon} onClick={() => setOffset((value) => value - 1)}>
          Previous week
        </Button>
        <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(0)}>
          This week
        </Button>
        <Button variant="secondary" icon={ArrowRightIcon} onClick={() => setOffset((value) => value + 1)}>
          Next week
        </Button>
        <p className="week-range" aria-live="polite">
          {formatWeekRange(days)}
        </p>
      </div>
      <ol className="week-grid">
        {days.map((key) => {
          const day = onDay(items, key);
          return (
            <li key={key} className={key === todayKey ? 'week-col is-today' : 'week-col'}>
              <h3 className="week-col-title">
                <span>{weekdayShort(key)}</span>
                <span className="week-col-num">{dayNumber(key)}</span>
              </h3>
              {day.length === 0 ? (
                <p className="week-col-empty">No appointments</p>
              ) : (
                <ul className="week-col-list">
                  {day.map((item) => (
                    <li key={item.id}>
                      <Link className="week-item" to={`/appointments/${item.id}`}>
                        <span className={`status-dot status-dot-${item.status}`} aria-hidden="true" />
                        <span className="week-item-time">{formatTime(item.startsAt)}</span>
                        <span className="week-item-name">
                          <ShownName id={item.clientId} />
                        </span>
                        <span className="sr-only">, {statusLabel(item.status)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Browser({ items }) {
  const now = useNow(60000);
  const [view, setView] = useState('list');
  const [filter, setFilter] = useState('all');
  const todayKey = dayKey(now);

  const counts = {
    all: items.length,
    scheduled: items.filter((item) => matchesFilter(item, 'scheduled')).length,
    closed: items.filter((item) => matchesFilter(item, 'closed')).length,
  };
  const visible = items.filter((item) => matchesFilter(item, filter));

  return (
    <>
      <div className="toolbar">
        <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
        <div className="chip-row" role="group" aria-label="Filter by status">
          <FilterChip pressed={filter === 'all'} count={counts.all} onClick={() => setFilter('all')}>
            All
          </FilterChip>
          <FilterChip pressed={filter === 'scheduled'} count={counts.scheduled} onClick={() => setFilter('scheduled')}>
            Scheduled
          </FilterChip>
          <FilterChip pressed={filter === 'closed'} count={counts.closed} onClick={() => setFilter('closed')}>
            Closed
          </FilterChip>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title="No appointments match this filter"
          art="calendar"
          action={
            <Button variant="secondary" onClick={() => setFilter('all')}>
              Show all appointments
            </Button>
          }
        >
          Choose another status, or show every appointment.
        </EmptyState>
      ) : view === 'list' ? (
        <AppointmentTable groups={groupByDay(visible, now)} />
      ) : (
        <WeekView items={visible} todayKey={todayKey} />
      )}
    </>
  );
}

export default function Appointments() {
  const { user } = useAuth();
  const state = useLoad(listAppointments, []);
  const canCreate = canAccess(user.role, 'newAppointment');

  const emptyAction = canCreate ? (
    <Button icon={PlusIcon} to="/appointments/new">
      Schedule an appointment
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Appointments">
        {canCreate && (
          <Button icon={PlusIcon} to="/appointments/new">
            New appointment
          </Button>
        )}
      </PageHeader>
      <section className="panel" aria-label="Appointment list">
        <Loaded
          state={state}
          errorTitle="Appointments could not load"
          skeleton="list"
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState title="No appointments yet" art="calendar" action={emptyAction}>
              {canCreate
                ? 'Schedule the first appointment by choosing a client and a time.'
                : 'Your professional schedules appointments. They will appear here once one is booked.'}
            </EmptyState>
          }
        >
          {(data) => <Browser items={data.items} />}
        </Loaded>
      </section>
    </>
  );
}
