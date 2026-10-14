import { useCallback, useEffect, useReducer, useState } from 'react';
import { mockProjects } from '../data/mockProjects';
import type { Project } from '../types';

const storageKey = 'llm-screenwriter.workspace.v1';
type History = { projects: Project[]; past: Project[][]; future: Project[][] };
type Action = { type: 'change'; update: (projects: Project[]) => Project[] } | { type: 'undo' } | { type: 'redo' };

type StoredProject = Omit<Project, 'acts'> & { acts?: number[] };

function isAct(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== 'object') return false;
  const item = value as StoredProject;
  return ['id', 'title', 'genre', 'logline'].every(key => typeof item[key as keyof Project] === 'string') &&
    (item.acts === undefined || (Array.isArray(item.acts) && item.acts.every(isAct) && new Set(item.acts).size === item.acts.length)) &&
    Array.isArray(item.scenes) && item.scenes.every(scene => scene &&
      ['id', 'title', 'heading', 'synopsis', 'notes'].every(key => typeof scene[key as keyof typeof scene] === 'string') &&
      isAct(scene.act) && (item.acts === undefined || item.acts.includes(scene.act)) && ['draft', 'review', 'ready'].includes(scene.status) &&
      Array.isArray(scene.characterIds) && scene.characterIds.every(id => typeof id === 'string') &&
      Array.isArray(scene.blocks) && scene.blocks.every(block => block && typeof block.id === 'string' &&
        typeof block.text === 'string' && ['action', 'character', 'dialogue', 'parenthetical', 'transition'].includes(block.type))) &&
    Array.isArray(item.characters) && item.characters.every(character => character &&
      ['id', 'name', 'age', 'role', 'goal', 'flaw', 'voice'].every(key => typeof character[key as keyof typeof character] === 'string'));
}

function loadWorkspace(): { projects: Project[]; warning: string } {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isProject)) {
        return {
          projects: parsed.map(project => ({
            ...project,
            // Older workspaces stored only the scene's act number.
            acts: project.acts ?? [...new Set([1, 2, 3, ...project.scenes.map(scene => scene.act)])].sort((a, b) => a - b),
          })),
          warning: '',
        };
      }
      return { projects: structuredClone(mockProjects), warning: 'Zapis lokalny jest niezgodny z formatem. Wczytano dane przykładowe.' };
    }
    return { projects: structuredClone(mockProjects), warning: '' };
  } catch {
    return { projects: structuredClone(mockProjects), warning: 'Nie udało się odczytać zapisu lokalnego. Wczytano dane przykładowe.' };
  }
}

function reducer(state: History, action: Action): History {
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous ? { projects: previous, past: state.past.slice(0, -1), future: [state.projects, ...state.future] } : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? { projects: next, past: [...state.past, state.projects].slice(-50), future: state.future.slice(1) } : state;
  }
  const projects = action.update(state.projects);
  return projects === state.projects ? state : { projects, past: [...state.past, state.projects].slice(-50), future: [] };
}

export function useWorkspace() {
  const [initial] = useState(loadWorkspace);
  const [state, dispatch] = useReducer(reducer, { projects: initial.projects, past: [], future: [] });
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  useEffect(() => {
    setSaveState('saving');
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(state.projects)); setSaveState('saved'); }
      catch { setSaveState('error'); }
    }, 500);
    return () => clearTimeout(timer);
  }, [state.projects]);
  useEffect(() => {
    const flush = () => { try { localStorage.setItem(storageKey, JSON.stringify(state.projects)); } catch { /* The status bar reports storage failures. */ } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [state.projects]);
  const updateProject = useCallback((id: string, update: (project: Project) => Project) => {
    dispatch({ type: 'change', update: projects => projects.map(project => project.id === id ? update(project) : project) });
  }, []);
  return {
    projects: state.projects, saveState, warning: initial.warning, updateProject,
    addProject: (project: Project) => dispatch({ type: 'change', update: projects => [...projects, project] }),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
  };
}
