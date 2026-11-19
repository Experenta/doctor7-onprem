import { Link } from 'react-router-dom';
import { friendlyMessage } from '../lib/errors.js';
import { AlertIcon, InboxIcon, LockIcon } from './icons.jsx';

export function Skeleton({ label = 'Loading' }) {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state">
      <InboxIcon />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This screen could not load' }) {
  return (
    <div className="state" role="alert">
      <AlertIcon />
      <h2>{title}</h2>
      <p>{friendlyMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function NoPermission() {
  return (
    <div className="state">
      <LockIcon />
      <h2>You do not have access to this screen</h2>
      <p>Your role cannot open this page. Go back to Home to see what you can do.</p>
      <Link className="btn btn-secondary" to="/">
        Go to Home
      </Link>
    </div>
  );
}

// Renders the four data states of a screen. `state` comes from useLoad.
// `children` is a function that receives the loaded data.
export function Loaded({ state, isEmpty, empty, errorTitle, children }) {
  if (state.status === 'loading') return <Skeleton />;
  if (state.status === 'error') {
    if (state.error && state.error.status === 403) return <NoPermission />;
    return <ErrorState error={state.error} onRetry={state.reload} title={errorTitle} />;
  }
  if (isEmpty && isEmpty(state.data)) return empty;
  return children(state.data);
}
