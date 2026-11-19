import { friendlyMessage } from '../lib/errors.js';
import { AlertIcon, LockIcon } from './icons.jsx';
import { Illustration } from './illustrations.jsx';
import { Button } from './ui.jsx';

// The blocks of each skeleton. They only draw the shape of the screen that is loading.
const SKELETON_BLOCKS = {
  lines: ['line', 'line', 'line'],
  list: ['row', 'row', 'row', 'row', 'row'],
  home: ['hero', 'tile', 'tile', 'tile', 'row', 'row'],
};

// A loading placeholder with a soft shimmer. One status region and one label, so a screen
// reader announces it once. The blocks are decoration.
export function Skeleton({ label = 'Loading', variant = 'lines' }) {
  const blocks = SKELETON_BLOCKS[variant] || SKELETON_BLOCKS.lines;
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="skeleton-blocks" aria-hidden="true">
        {blocks.map((kind, index) => (
          <span key={index} className={`skeleton-block skeleton-${kind}`} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action, art = 'tray' }) {
  return (
    <div className="state state-empty">
      <Illustration name={art} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This screen could not load' }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon">
        <AlertIcon />
      </span>
      <h2>{title}</h2>
      <p>{friendlyMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function NoPermission() {
  return (
    <div className="state state-locked">
      <span className="state-icon">
        <LockIcon />
      </span>
      <h2>You do not have access to this screen</h2>
      <p>Your role cannot open this page. Go back to Home to see what you can do.</p>
      <Button variant="secondary" to="/">
        Go to Home
      </Button>
    </div>
  );
}

// Renders the four data states of a screen. `state` comes from useLoad.
// `children` is a function that receives the loaded data. `skeleton` picks the loading shape.
export function Loaded({ state, isEmpty, empty, errorTitle, skeleton = 'lines', children }) {
  if (state.status === 'loading') return <Skeleton variant={skeleton} />;
  if (state.status === 'error') {
    if (state.error && state.error.status === 403) return <NoPermission />;
    return <ErrorState error={state.error} onRetry={state.reload} title={errorTitle} />;
  }
  if (isEmpty && isEmpty(state.data)) return empty;
  return children(state.data);
}
