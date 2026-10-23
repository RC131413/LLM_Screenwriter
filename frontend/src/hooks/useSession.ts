import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import type { ApiUser, ChangePasswordInput, LoginInput, RegisterInput } from '../services/api';
import { errorMessage } from '../services/workspaceData';

export function useSession() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const passwordChange = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void api.auth.csrf({ signal: controller.signal }).then(() => api.account.get({ signal: controller.signal }))
      .then(value => { if (!controller.signal.aborted) setUser(value); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        setUser(null);
        if (!(failure instanceof ApiError && failure.status === 401)) setError(errorMessage(failure));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const expired = () => setUser(null);
    window.addEventListener('api:unauthorized', expired);
    return () => { controller.abort(); window.removeEventListener('api:unauthorized', expired); };
  }, [version]);
  const refresh = useCallback(async () => {
    const value = await api.account.get(); setUser(value); return value;
  }, []);
  return {
    user, loading, loggingOut, error, refresh, retry: () => setVersion(value => value + 1),
    login: async (data: LoginInput) => { const value = await api.auth.login(data); setUser(value); },
    register: async (data: RegisterInput) => { const value = await api.auth.register(data); setUser(value); },
    changePassword: (data: ChangePasswordInput) => {
      const result = passwordChange.current.then(() => api.account.changePassword(data));
      passwordChange.current = result.catch(() => undefined);
      return result;
    },
    logout: async () => {
      setLoggingOut(true);
      try { await passwordChange.current; await api.auth.logout(); setUser(null); window.location.hash = '#login'; }
      finally { setLoggingOut(false); }
    },
  };
}
