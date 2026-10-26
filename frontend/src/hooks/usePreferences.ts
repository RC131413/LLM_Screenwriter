import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { errorMessage } from '../services/workspaceData';
import type { UserPreferences } from '../types';

export function usePreferences(userId?: number) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPreferences(null); setError(''); setLoading(!!userId);
    if (!userId) return;
    void api.account.getPreferences({ signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setPreferences(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, version]);
  const savePreferences = useCallback(async (next: UserPreferences) => {
    const saved = await api.account.savePreferences(next); setPreferences(saved); return saved;
  }, []);
  return {
    preferences, loading, error, savePreferences, retry: () => setVersion(value => value + 1),
    resetPreferences: async () => { const saved = await api.account.savePreferences({}); setPreferences(saved); return saved; },
  };
}
