import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: loading | signedOut | signedIn | error
  const [state, setState] = useState({ status: 'loading', user: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', user: null, error: null });
    api.getMe().then(
      (payload) => {
        if (active) setState({ status: 'signedIn', user: payload.user, error: null });
      },
      (error) => {
        if (!active) return;
        if (error.status === 401) setState({ status: 'signedOut', user: null, error: null });
        else setState({ status: 'error', user: null, error });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ status: 'signedOut', user: null, error: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, retry, signOut }), [state, retry, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
