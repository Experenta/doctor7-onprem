import { Link } from 'react-router-dom';
import { listAppointments } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PlusIcon } from '../components/icons.jsx';
import { EmptyState, Loaded } from '../components/States.jsx';
import { canAccess } from '../lib/access.js';
import { statusLabel } from '../lib/appointments.js';
import { formatDateTime } from '../lib/format.js';
import { useLoad } from '../lib/useLoad.js';

export default function Appointments() {
  const { user } = useAuth();
  const state = useLoad(listAppointments, []);
  const canCreate = canAccess(user.role, 'newAppointment');

  const emptyAction = canCreate ? (
    <Link className="btn btn-primary" to="/appointments/new">
      <PlusIcon />
      Schedule an appointment
    </Link>
  ) : null;

  return (
    <>
      <div className="page-head">
        <h1>Appointments</h1>
        {canCreate && (
          <Link className="btn btn-primary" to="/appointments/new">
            <PlusIcon />
            New appointment
          </Link>
        )}
      </div>
      <section className="panel" aria-label="Appointment list">
        <Loaded
          state={state}
          errorTitle="Appointments could not load"
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState title="No appointments yet" action={emptyAction}>
              {canCreate
                ? 'Schedule the first appointment by choosing a client and a time.'
                : 'Your professional schedules appointments. They will appear here once one is booked.'}
            </EmptyState>
          }
        >
          {(data) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Starts</th>
                    <th scope="col">Ends</th>
                    <th scope="col">Status</th>
                    <th scope="col">Professional</th>
                    <th scope="col">Client</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Starts">
                        <Link to={`/appointments/${item.id}`}>{formatDateTime(item.startsAt)}</Link>
                      </td>
                      <td data-label="Ends">{formatDateTime(item.endsAt)}</td>
                      <td data-label="Status">
                        <span className="badge">{statusLabel(item.status)}</span>
                      </td>
                      <td data-label="Professional" className="cell-break">
                        {item.professionalId}
                      </td>
                      <td data-label="Client" className="cell-break">
                        {item.clientId}
                      </td>
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
