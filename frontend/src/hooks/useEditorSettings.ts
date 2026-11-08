import { useCallback, useEffect, useState } from 'react';
import type { EditorSettings } from '../types';

const DEFAULTS: EditorSettings = { zoom: 100, spellCheck: false, showBlockTypes: false };
const keyFor = (userId: number) => `agentdraft.editor.${userId}`;

function normalize(value: Partial<EditorSettings>): EditorSettings {
  return {
    zoom: typeof value.zoom === 'number' && Number.isFinite(value.zoom) ? Math.max(50, Math.min(200, value.zoom)) : DEFAULTS.zoom,
    spellCheck: typeof value.spellCheck === 'boolean' ? value.spellCheck : DEFAULTS.spellCheck,
    showBlockTypes: typeof value.showBlockTypes === 'boolean' ? value.showBlockTypes : DEFAULTS.showBlockTypes,
  };
}

function read(userId?: number): EditorSettings {
  if (userId === undefined) return DEFAULTS;
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(userId)) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? normalize(value) : DEFAULTS;
  } catch { return DEFAULTS; }
}

/** Personal display settings for this browser, kept separate from screenplay data. */
export function useEditorSettings(userId?: number) {
  const [snapshot, setSnapshot] = useState(() => ({ userId, settings: read(userId) }));
  useEffect(() => {
    setSnapshot(previous => previous.userId === userId ? previous : { userId, settings: read(userId) });
  }, [userId]);
  useEffect(() => {
    if (userId === undefined || snapshot.userId !== userId) return;
    try { localStorage.setItem(keyFor(userId), JSON.stringify(snapshot.settings)); }
    catch { /* Display controls still work when browser storage is unavailable. */ }
  }, [userId, snapshot]);

  const updateSettings = useCallback((patch: Partial<EditorSettings>) => {
    setSnapshot(previous => ({ userId,
      settings: normalize({ ...(previous.userId === userId ? previous.settings : read(userId)), ...patch }),
    }));
  }, [userId]);
  return { settings: snapshot.userId === userId ? snapshot.settings : DEFAULTS, updateSettings };
}
