import { useCallback, useState } from 'react';
import type { UserPreferences } from '../types';

const storageKey = 'llm-screenwriter.preferences.v1';

export function defaultPreferences(): UserPreferences {
  return {
    writing_style_preferences: {
      stage_directions_style: 'concise_technical',
      dialogue_tone: 'Neutralny, realistyczny',
      parentheticals: 'sparingly',
    },
    llm_preferences: { model_name: 'Bielik 11B (Lokalny)', temperature: 0.7, max_tokens: 2048 },
  };
}

function loadPreferences(): UserPreferences {
  const defaults = defaultPreferences();
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return defaults;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const value = parsed as Partial<UserPreferences>;
    const style = value.writing_style_preferences;
    const engine = value.llm_preferences;
    return {
      writing_style_preferences: {
        stage_directions_style: style?.stage_directions_style === 'literary_descriptive' ? 'literary_descriptive' : 'concise_technical',
        dialogue_tone: typeof style?.dialogue_tone === 'string' ? style.dialogue_tone : defaults.writing_style_preferences.dialogue_tone,
        parentheticals: style?.parentheticals === 'ignore' ? 'ignore' : 'sparingly',
      },
      llm_preferences: {
        model_name: defaults.llm_preferences.model_name,
        temperature: typeof engine?.temperature === 'number' && Number.isFinite(engine.temperature) && engine.temperature >= 0 && engine.temperature <= 1
          ? Math.round(engine.temperature * 10) / 10 : defaults.llm_preferences.temperature,
        max_tokens: typeof engine?.max_tokens === 'number' && Number.isSafeInteger(engine.max_tokens) && engine.max_tokens > 0
          ? engine.max_tokens : defaults.llm_preferences.max_tokens,
      },
    };
  } catch { return defaults; }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const savePreferences = useCallback((next: UserPreferences) => {
    try {
      const value = { ...next, llm_preferences: { ...next.llm_preferences, model_name: 'Bielik 11B (Lokalny)' as const } };
      localStorage.setItem(storageKey, JSON.stringify(value));
      setPreferences(value);
      return true;
    } catch { return false; }
  }, []);
  return { preferences, savePreferences };
}
