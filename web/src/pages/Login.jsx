import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorState, Skeleton } from '../components/States.jsx';

export default function Login() {
  const { status, error, retry } = useAuth();

  if (status === 'signedIn') return <Navigate to="/" replace />;

  return (
    <div className="login">
      <div className="login-band" aria-hidden="true" />
      <main className="login-card">
        <h1>Sign in to Doctor7</h1>
        {status === 'loading' && <Skeleton label="Checking your session" />}
        {status === 'error' && (
          <ErrorState error={error} onRetry={retry} title="Your session could not be checked" />
        )}
        {status === 'signedOut' && (
          <>
            <p>
              Use your clinic account. You will go to your clinic&apos;s sign-in page and return here
              when you finish.
            </p>
            <a className="btn btn-primary" href="/api/auth/login">
              Sign in
            </a>
          </>
        )}
      </main>
    </div>
  );
}
