import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { allPages, errorMessage } from '../services/workspaceData';
import type { PromptHistoryEntry } from '../types';

export function usePromptHistory(projectId: string, sceneId: string | undefined) {
  const [entries, setEntries] = useState<PromptHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setEntries([]); setError('');
    if (!sceneId) return;
    const controller = new AbortController(); setLoading(true);
    void allPages(params => api.prompts.list(Number(sceneId), params, { signal: controller.signal }), controller.signal)
      .then(prompts => { if (!controller.signal.aborted) setEntries(prompts.map(prompt => ({
        id: String(prompt.id), project_id: projectId, scene_id: sceneId, prompt: prompt.user_prompt, created_at: prompt.created_at,
      }))); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, sceneId, version]);
  return {
    entries, loading, error, retry: () => setVersion(value => value + 1),
    recordPrompt: async (prompt: string) => {
      if (!sceneId) throw new Error('Wybierz scenę.');
      await api.prompts.create(Number(sceneId), { user_prompt: prompt });
      setVersion(value => value + 1);
    },
  };
}
