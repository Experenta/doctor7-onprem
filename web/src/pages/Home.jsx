import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createMeeting, listAppointments, listAudit } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  ArrowRightIcon,
  BanIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PlusIcon,
  PulseIcon,
  ShieldIcon,
  VideoIcon,
  WeekIcon,
} from '../components/icons.jsx';
import { EmptyState, Loaded } from '../components/States.jsx';
import { Avatar, Button, Card, Chip, InlineAlert, StatTile, StatusChip } from '../components/ui.jsx';
import { canAccess, roleLabel } from '../lib/access.js';
import { isInProgress, safeVideoUrl, statusLabel, upcomingAppointments } from '../lib/appointments.js';
import { friendlyMessage } from '../lib/errors.js';
import { formatDateTime, formatTime } from '../lib/format.js';
import { getMeeting, MEETING_CLOSED_MESSAGE, MEETING_POLL_MS } from '../lib/meeting.js';
import { countdownText, dayKey, formatDayKey, formatToday, onDay, weekDays, weekdayShort, dayNumber } from '../lib/schedule.js';
import { useLoad } from '../lib/useLoad.js';
import { useNow } from '../lib/useNow.js';

const AUDIT_PAGE_SIZE = 100;
const MAX_DOTS = 4;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function WelcomeBand({ user, children }) {
  return (
    <section className="welcome-band" aria-labelledby="welcome-title">
      <div className="welcome-text">
        <h1 id="welcome-title">Welcome, {user.displayName}</h1>
        <p className="welcome-meta">
          <span>{formatToday()}</span>
          <Chip tone="dark">{roleLabel(user.role)}</Chip>
        </p>
      </div>
      {children && <div className="welcome-actions">{children}</div>}
    </section>
  );
}

function StartMeeting({ appointmentId }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ busy: false, error: '' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The server stores the meeting. The appointment screen then reads it and shows it.
  async function start() {
    setState({ busy: true, error: '' });
    try {
      await createMeeting(appointmentId);
      if (alive.current) navigate(`/appointments/${appointmentId}`);
    } catch (error) {
      if (!alive.current) return;
      const closed = error && error.code === 'appointment_closed';
      setState({ busy: false, error: closed ? MEETING_CLOSED_MESSAGE : friendlyMessage(error) });
    }
  }

  return (
    <>
      <Button
        icon={VideoIcon}
        onClick={start}
        disabled={state.busy}
        aria-busy={state.busy}
      >
        {state.busy ? 'Starting video meeting' : 'Start video meeting'}
      </Button>
      {state.error && <InlineAlert>{state.error}</InlineAlert>}
    </>
  );
}

// The state of the stored meeting, for the client. A 404 means that the professional has not
// started it. While the tab is visible the client asks again every 15 seconds, like the
// video panel of the appointment screen, and stops when the room is ready.
function useRoom(appointmentId) {
  const [room, setRoom] = useState('checking'); // checking | waiting | ready | unknown

  useEffect(() => {
    let active = true;
    setRoom('checking');
    getMeeting(appointmentId).then(
      (meeting) => {
        if (active) setRoom(safeVideoUrl(meeting && meeting.url) ? 'ready' : 'unknown');
      },
      (error) => {
        if (active) setRoom(error && error.status === 404 ? 'waiting' : 'unknown');
      },
    );
    return () => {
      active = false;
    };
  }, [appointmentId]);

  const waiting = room === 'waiting';
  useEffect(() => {
    if (!waiting) return undefined;
    let active = true;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const meeting = await getMeeting(appointmentId);
        if (active) setRoom(safeVideoUrl(meeting && meeting.url) ? 'ready' : 'unknown');
      } catch (error) {
        if (active && !(error && error.status === 404)) setRoom('unknown');
      } finally {
        busy = false;
      }
    }, MEETING_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [waiting, appointmentId]);

  return room;
}

function RoomState({ room }) {
  if (room === 'waiting') {
    return (
      <p className="room room-waiting" role="status">
        <span className="pulse-dot" aria-hidden="true" />
        Your professional has not started yet
      </p>
    );
  }
  if (room === 'ready') {
    return (
      <p className="room room-ready" role="status">
        <CheckIcon />
        Room ready
      </p>
    );
  }
  if (room === 'unknown') {
    return <p className="room muted">The room could not be checked. Open the appointment to see its state.</p>;
  }
  return (
    <p className="room muted" role="status">
      Checking the room
    </p>
  );
}

// The hero card: the next appointment. `counterpart` is the other person, `note` is a line
// under the person (the room state for a client), and `children` are the actions.
function NextAppointment({ appointment, now, counterpart, counterpartRole, note, children }) {
  const start = new Date(appointment.startsAt).getTime();
  const happening = isInProgress(appointment, now);

  return (
    <Card as="section" className="hero" aria-labelledby="hero-title">
      <div className="hero-head">
        <h2 id="hero-title">Next appointment</h2>
        {happening ? (
          <Chip tone="teal" icon={ClockIcon}>
            Happening now
          </Chip>
        ) : (
          <Chip tone="purple" icon={ClockIcon}>
            {countdownText(start - now)}
          </Chip>
        )}
      </div>
      <p className="hero-time">{formatTime(appointment.startsAt)}</p>
      <p className="hero-date">
        <time dateTime={appointment.startsAt}>{formatDateTime(appointment.startsAt)}</time>
      </p>
      <div className="hero-person">
        <Avatar name={counterpart} size="lg" tone="turquoise" />
        <div className="hero-person-text">
          <span className="hero-person-name">{counterpart}</span>
          <span className="hero-person-role">{counterpartRole}</span>
        </div>
      </div>
      {note}
      <div className="hero-actions">
        {children}
        <Button variant="secondary" to={`/appointments/${appointment.id}`}>
          Open next appointment
        </Button>
      </div>
    </Card>
  );
}

// The client's hero reads the stored meeting, so only the client's screen asks for it.
function ClientNextAppointment({ appointment, now }) {
  const room = useRoom(appointment.id);
  return (
    <NextAppointment
      appointment={appointment}
      now={now}
      counterpart={appointment.professionalId}
      counterpartRole="Professional"
      note={<RoomState room={room} />}
    >
      {room === 'ready' && (
        <Button icon={VideoIcon} to={`/appointments/${appointment.id}`}>
          Join video meeting
        </Button>
      )}
    </NextAppointment>
  );
}

function NoUpcoming({ children }) {
  return (
    <Card as="section" className="hero hero-empty" aria-label="Next appointment">
      <EmptyState title="No upcoming appointments" art="calendar">
        {children}
      </EmptyState>
    </Card>
  );
}

function WeekStrip({ items, todayKey }) {
  const days = weekDays(todayKey);
  return (
    <Card as="section" aria-labelledby="week-title">
      <h2 id="week-title">Week at a glance</h2>
      <ol className="week-strip">
        {days.map((key) => {
          const count = items.filter((item) => item.status !== 'cancelled' && dayKey(item.startsAt) === key).length;
          return (
            <li key={key} className={key === todayKey ? 'week-day is-today' : 'week-day'}>
              <span className="week-name" aria-hidden="true">
                {weekdayShort(key)}
              </span>
              <span className="week-num" aria-hidden="true">
                {dayNumber(key)}
              </span>
              <span className="week-dots" aria-hidden="true">
                {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, index) => (
                  <span key={index} className="week-dot" />
                ))}
              </span>
              <span className="sr-only">
                {formatDayKey(key)}: {plural(count, 'appointment', 'appointments')}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function TodayList({ items, todayKey }) {
  const today = onDay(items, todayKey);
  return (
    <Card as="section" aria-labelledby="today-title">
      <h2 id="today-title">Today</h2>
      {today.length === 0 ? (
        <p className="muted">Nothing is scheduled for today.</p>
      ) : (
        <ul className="mini-list">
          {today.map((item) => (
            <li key={item.id} className="mini-row">
              <span className="mini-time">{formatTime(item.startsAt)}</span>
              <Avatar name={item.clientId} />
              <span className="mini-name">{item.clientId}</span>
              <StatusChip status={item.status}>{statusLabel(item.status)}</StatusChip>
              <Link className="mini-link" to={`/appointments/${item.id}`} aria-label={`Open the appointment at ${formatTime(item.startsAt)}`}>
                <ArrowRightIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ComingUp({ items, others }) {
  if (items.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="coming-title">
      <h2 id="coming-title">Coming up</h2>
      <ul className="mini-list">
        {items.map((item) => (
          <li key={item.id} className="mini-row">
            <Avatar name={others(item)} />
            <span className="mini-name">{others(item)}</span>
            <Link className="mini-when" to={`/appointments/${item.id}`}>
              {formatDateTime(item.startsAt)}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProfessionalHome({ items }) {
  const now = useNow();
  const todayKey = dayKey(now);
  const upcoming = upcomingAppointments(items, now);
  const week = weekDays(todayKey);
  const live = items.filter((item) => item.status !== 'cancelled');
  const thisWeek = live.filter((item) => week.includes(dayKey(item.startsAt))).length;
  const past = live.filter((item) => new Date(item.endsAt).getTime() <= now).length;

  return (
    <div className="home-grid home-grid-hero">
      {upcoming[0] ? (
        <NextAppointment
          appointment={upcoming[0]}
          now={now}
          counterpart={upcoming[0].clientId}
          counterpartRole="Client"
        >
          <StartMeeting appointmentId={upcoming[0].id} />
        </NextAppointment>
      ) : (
        <NoUpcoming>Use Schedule an appointment above to book the next one. It will show here.</NoUpcoming>
      )}
      <div className="stat-grid">
        <StatTile icon={CalendarIcon} value={upcoming.length} label="Upcoming appointments" />
        <StatTile icon={WeekIcon} tone="turquoise" value={thisWeek} label="Appointments this week" hint="Monday to Sunday" />
        <StatTile icon={CheckIcon} value={past} label="Past appointments" hint="Ended, not cancelled" />
      </div>
      <WeekStrip items={items} todayKey={todayKey} />
      <TodayList items={items} todayKey={todayKey} />
    </div>
  );
}

function ClientHome({ items }) {
  const now = useNow();
  const upcoming = upcomingAppointments(items, now);
  return (
    <div className="home-grid home-grid-hero">
      {upcoming[0] ? (
        <ClientNextAppointment appointment={upcoming[0]} now={now} />
      ) : (
        <NoUpcoming>Your professional schedules appointments. They will appear here once one is booked.</NoUpcoming>
      )}
      <ComingUp items={upcoming.slice(1, 4)} others={(item) => item.professionalId} />
    </div>
  );
}

function AdminHome({ items }) {
  const now = useNow();
  const upcoming = upcomingAppointments(items, now);
  const count = (status) => items.filter((item) => item.status === status).length;

  if (items.length === 0) {
    return (
      <Card as="section" aria-label="Center summary">
        <EmptyState title="No appointments yet" art="calendar">
          Schedule the first appointment by choosing a client and a time.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="home-grid">
      <div className="stat-grid" aria-label="Appointments by status" role="group">
        <StatTile icon={CalendarIcon} value={count('scheduled')} label="Scheduled" hint={`${items.length} in total`} />
        <StatTile icon={CheckIcon} tone="turquoise" value={count('completed')} label="Completed" />
        <StatTile icon={BanIcon} value={count('cancelled')} label="Cancelled" />
      </div>
      <ComingUp items={upcoming.slice(0, 5)} others={(item) => `${item.professionalId} with ${item.clientId}`} />
    </div>
  );
}

function AppointmentHome({ role }) {
  const state = useLoad(listAppointments, []);
  return (
    <Loaded state={state} errorTitle="Appointments could not load" skeleton="home">
      {(data) => {
        if (role === 'professional') return <ProfessionalHome items={data.items} />;
        if (role === 'client') return <ClientHome items={data.items} />;
        return <AdminHome items={data.items} />;
      }}
    </Loaded>
  );
}

function AuditSummary() {
  const now = useNow();
  const state = useLoad(() => listAudit(), []);
  const todayKey = dayKey(now);
  return (
    <Loaded
      state={state}
      errorTitle="The audit summary could not load"
      skeleton="home"
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Card as="section" aria-label="Audit summary">
          <EmptyState title="No audit entries yet">Entries appear here when someone reads or changes a record.</EmptyState>
        </Card>
      }
    >
      {(data) => {
        const today = data.items.filter((entry) => dayKey(entry.occurredAt) === todayKey);
        const denied = today.filter((entry) => entry.outcome === 'denied').length;
        // The API answers with the newest entries. When the answer is full and all of it is
        // from today, there may be more entries today than were returned.
        const capped = data.items.length >= AUDIT_PAGE_SIZE && today.length === data.items.length;
        return (
          <div className="stat-grid stat-grid-wide">
            <StatTile
              icon={PulseIcon}
              tone="turquoise"
              value={capped ? `${today.length}+` : today.length}
              label="Audit entries today"
              hint="From the newest 100 entries"
            />
            <StatTile icon={BanIcon} value={denied} label="Denied today" hint="Refused requests" />
          </div>
        );
      }}
    </Loaded>
  );
}

export default function Home() {
  const { user } = useAuth();
  const role = user.role;

  return (
    <>
      <WelcomeBand user={user}>
        {canAccess(role, 'newAppointment') && (
          <Button variant="on-band" icon={PlusIcon} to="/appointments/new">
            {role === 'admin' ? 'New appointment' : 'Schedule an appointment'}
          </Button>
        )}
        {role === 'client' && (
          <Button variant="on-band" icon={CalendarIcon} to="/appointments">
            View appointments
          </Button>
        )}
        {canAccess(role, 'audit') && (
          <Button variant="on-band" icon={ShieldIcon} to="/audit">
            Open audit log
          </Button>
        )}
      </WelcomeBand>
      {canAccess(role, 'appointments') && <AppointmentHome role={role} />}
      {role === 'auditor' && <AuditSummary />}
    </>
  );
}
