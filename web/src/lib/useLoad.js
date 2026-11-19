import { useCallback, useEffect, useState } from 'react';

// Runs `load` and reports loading, error, or ready. `reload` runs it again.
export function useLoad(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, error: null });
    load().then(
      (data) => {
        if (active) setState({ status: 'ready', data, error: null });
      },
      (error) => {
        if (active) setState({ status: 'error', data: null, error });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
