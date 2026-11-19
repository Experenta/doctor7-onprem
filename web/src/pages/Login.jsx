import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Glyph, Logotype } from '../components/brand.jsx';
import { ErrorState, Skeleton } from '../components/States.jsx';
import { Button } from '../components/ui.jsx';

export default function Login() {
  const { status, error, retry } = useAuth();

  if (status === 'signedIn') return <Navigate to="/" replace />;

  return (
    <div className="login">
      <div className="login-band">
        <div className="login-brand">
          <Glyph />
          <Logotype />
        </div>
        <p className="login-pitch">Psychological care that your clinic runs on its own server.</p>
      </div>
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
            <Button href="/api/auth/login">Sign in</Button>
          </>
        )}
      </main>
    </div>
  );
}
