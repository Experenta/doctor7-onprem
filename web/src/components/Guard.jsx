import { Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { canAccess } from '../lib/access.js';
import Layout from './Layout.jsx';
import { ErrorState, NoPermission, Skeleton } from './States.jsx';

// Wraps every screen except sign-in. Visitors without a session go to /login.
export function Shell() {
  const { status, error, retry } = useAuth();

  if (status === 'loading') {
    return (
      <main className="app-main">
        <Skeleton label="Checking your session" />
      </main>
    );
  }
  if (status === 'error') {
    return (
      <main className="app-main">
        <ErrorState error={error} onRetry={retry} title="Your session could not be checked" />
      </main>
    );
  }
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  return <Layout />;
}

// Shows a screen only to the roles listed for it in lib/access.js. The screen's
// code loads inside the boundary, so the skeleton shows while it arrives.
export function Screen({ id, children }) {
  const { user } = useAuth();
  if (!canAccess(user.role, id)) return <NoPermission />;
  return <Suspense fallback={<Skeleton label="Loading this screen" />}>{children}</Suspense>;
}
