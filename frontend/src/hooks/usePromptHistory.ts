import { useState } from 'react';
import { newId } from '../types';
import type { PromptHistoryEntry } from '../types';

const storageKey = 'llm-screenwriter.prompt-history.v1';

function loadHistory(): PromptHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is PromptHistoryEntry => entry && typeof entry === 'object' &&
      ['id', 'project_id', 'scene_id', 'prompt', 'created_at'].every(key => typeof entry[key] === 'string') &&
      entry.prompt.trim() && Number.isFinite(Date.parse(entry.created_at)));
  } catch { return []; }
}

export function usePromptHistory(projectId: string, sceneId: string | undefined) {
  const [history, setHistory] = useState(loadHistory);
  const [warning, setWarning] = useState('');
  const entries = history.filter(entry => entry.project_id === projectId && entry.scene_id === sceneId);

  function recordPrompt(prompt: string) {
    if (!sceneId || !prompt.trim()) return;
    const entry: PromptHistoryEntry = { id: newId(), project_id: projectId, scene_id: sceneId, prompt, created_at: new Date().toISOString() };
    const next = [entry, ...history];
    setHistory(next); setWarning('');
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setWarning('Nie udało się zapisać historii. Nowe wpisy będą dostępne tylko do zamknięcia panelu.'); }
  }

  return { entries, recordPrompt, warning };
}
