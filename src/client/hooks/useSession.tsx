/** Session context: current user, entitlement, sign in/out helpers. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUser } from '../../shared/contracts';
import { api, ApiClientError } from '../lib/api';

type SessionValue = {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Re-enter a loading state so route guards (RedirectIfAuthed/RequireAuth)
    // do not race the caller's own navigation right after sign-up/sign-in.
    setLoading(true);
    try {
      const res = await api<{ user: SessionUser }>('/auth/me');
      setUser(res.user);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) setUser(null);
      else setError(err instanceof Error ? err.message : 'Could not load your session.');
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, error, refresh, signOut }),
    [user, loading, error, refresh, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
