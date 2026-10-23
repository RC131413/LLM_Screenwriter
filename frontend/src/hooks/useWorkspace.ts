import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { CreateProjectInput, ProjectAction } from '../services/api';
import { allPages, errorMessage, scenePayload, toProject } from '../services/workspaceData';
import type { Act, Character, Project, Scene } from '../types';

export function useWorkspace(userId?: number) {
  const [projects, setProjects] = useState<Project[]>([]);
  const current = useRef<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [mutating, setMutating] = useState(false);
  const [version, setVersion] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const pending = useRef(new Map<string, Scene>());
  const past = useRef(new Map<string, Scene[]>());
  const future = useRef(new Map<string, Scene[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const jobs = useRef(0);
  const mutationCount = useRef(0);
  const epoch = useRef(0);

  const replace = useCallback((next: Project[]) => { current.current = next; setProjects(next); }, []);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const generation = epoch.current;
    jobs.current++; setSaveState('saving'); setError('');
    const result = queue.current.catch(() => undefined).then(async () => {
      if (generation !== epoch.current) throw new Error('Sesja została zmieniona.');
      return operation();
    });
    queue.current = result.then(() => undefined, () => undefined);
    return result.then(value => {
      jobs.current--;
      if (generation === epoch.current && !jobs.current && !pending.current.size) setSaveState('saved');
      return value;
    }, failure => {
      jobs.current--;
      if (generation === epoch.current) { setError(errorMessage(failure)); setSaveState('error'); }
      throw failure;
    });
  }, []);

  const reloadProject = useCallback(async (projectId: string) => {
    const generation = epoch.current;
    const project = toProject(await api.projects.workspace(Number(projectId)));
    if (generation !== epoch.current) return project;
    for (const scene of project.scenes) { past.current.delete(scene.id); future.current.delete(scene.id); }
    project.scenes = project.scenes.map(scene => pending.current.get(scene.id) ?? scene);
    replace(current.current.some(item => item.id === projectId)
      ? current.current.map(item => item.id === projectId ? project : item) : [project, ...current.current]);
    return project;
  }, [replace]);

  const flush = useCallback(async () => {
    const generation = epoch.current;
    clearTimeout(timer.current);
    const drafts = [...pending.current.values()];
    pending.current.clear();
    if (drafts.length) {
      try {
        await enqueue(async () => {
          for (const scene of drafts) {
            const saved = await api.scenes.update(Number(scene.id), scenePayload(scene));
            const desired = new Set(scene.characterIds);
            for (const member of saved.cast_members) {
              if (!desired.has(String(member.character_id))) await api.cast.delete(member.id);
            }
            const existing = new Set(saved.cast_members.map(member => String(member.character_id)));
            for (const characterId of desired) {
              if (!existing.has(characterId)) await api.cast.create(saved.id, { character_id: Number(characterId) });
            }
          }
        });
      } catch (failure) {
        if (generation === epoch.current) {
          for (const scene of drafts) if (!pending.current.has(scene.id)) pending.current.set(scene.id, scene);
        }
        throw failure;
      }
    }
    await queue.current;
  }, [enqueue]);

  useEffect(() => {
    epoch.current++; clearTimeout(timer.current);
    pending.current.clear(); past.current.clear(); future.current.clear();
    replace([]); setError(''); setLoadError(''); setLoading(!!userId); setSaveState('saved');
    if (!userId) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.all((['all', 'archive', 'trash'] as const).map(collection =>
      allPages(params => api.projects.list({ ...params, collection }, options), controller.signal),
    )).then(async collections => {
      const unique = [...new Map(collections.flat().map(project => [project.id, project])).values()];
      const loaded: Project[] = [];
      // Bound hydration requests while fetching counts and full editor data.
      for (let index = 0; index < unique.length; index += 6) {
        loaded.push(...await Promise.all(unique.slice(index, index + 6).map(async project =>
          toProject(await api.projects.workspace(project.id, options)))));
      }
      if (!controller.signal.aborted) replace(loaded);
    }).catch(failure => { if (!controller.signal.aborted) setLoadError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, version, replace]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current.size || jobs.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timer.current); };
  }, []);

  const draftScene = useCallback((scene: Scene, history = true) => {
    const previous = current.current.flatMap(project => project.scenes).find(item => item.id === scene.id);
    if (!previous) return;
    if (history) {
      past.current.set(scene.id, [...(past.current.get(scene.id) ?? []), previous].slice(-50));
      future.current.delete(scene.id);
    }
    replace(current.current.map(project => ({ ...project, scenes: project.scenes.map(item => item.id === scene.id ? scene : item) })));
    pending.current.set(scene.id, scene); setSaveState('saving'); setHistoryVersion(value => value + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 600);
  }, [flush, replace]);

  const mutate = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    mutationCount.current++; setMutating(true);
    try { await flush(); return await enqueue(operation); }
    finally { mutationCount.current--; if (!mutationCount.current) setMutating(false); }
  }, [enqueue, flush]);

  const projectById = (projectId: string) => {
    const project = current.current.find(item => item.id === projectId);
    if (!project) throw new Error('Nie znaleziono projektu.');
    return project;
  };

  return {
    projects, loading, loadError, error, saveState, mutating, historyVersion, flush, reloadProject,
    retry: () => { if (pending.current.size) void flush().catch(() => undefined); else setVersion(value => value + 1); },
    updateScene: draftScene,
    canUndo: (sceneId?: string) => !!sceneId && !!past.current.get(sceneId)?.length,
    canRedo: (sceneId?: string) => !!sceneId && !!future.current.get(sceneId)?.length,
    undo: (sceneId: string) => {
      const previous = past.current.get(sceneId)?.pop();
      const scene = current.current.flatMap(project => project.scenes).find(item => item.id === sceneId);
      if (previous && scene) { future.current.set(sceneId, [scene, ...(future.current.get(sceneId) ?? [])]); draftScene(previous, false); }
    },
    redo: (sceneId: string) => {
      const next = future.current.get(sceneId)?.shift();
      const scene = current.current.flatMap(project => project.scenes).find(item => item.id === sceneId);
      if (next && scene) { past.current.set(sceneId, [...(past.current.get(sceneId) ?? []), scene]); draftScene(next, false); }
    },
    createProject: (details: CreateProjectInput) => mutate(async () => {
      const saved = await api.projects.create(details);
      return reloadProject(String(saved.id));
    }),
    editProject: (projectId: string, details: CreateProjectInput) => mutate(async () => {
      await api.projects.update(Number(projectId), details); await reloadProject(projectId);
    }),
    projectAction: (projectId: string, action: ProjectAction) => mutate(async () => {
      const saved = await api.projects.action(Number(projectId), action);
      replace(current.current.map(project => project.id === projectId ? { ...project, metadata: saved.metadata } : project));
    }),
    removeProject: (projectId: string) => mutate(async () => {
      await api.projects.delete(Number(projectId)); replace(current.current.filter(project => project.id !== projectId));
    }),
    addAct: (projectId: string) => mutate(async () => {
      const project = projectById(projectId);
      await api.acts.create(Number(projectId), { act_number: Math.max(0, ...project.acts.map(act => act.act_number)) + 1, sort_order: project.acts.length });
      await reloadProject(projectId);
    }),
    editAct: (projectId: string, act: Act) => mutate(async () => {
      await api.acts.update(Number(act.id), { title: act.title, summary: act.summary }); await reloadProject(projectId);
    }),
    removeAct: (projectId: string, act: Act) => mutate(async () => {
      const project = projectById(projectId);
      if (project.scenes.some(scene => scene.act === act.act_number)) throw new Error('Przenieś lub usuń sceny przed usunięciem aktu.');
      await api.acts.delete(Number(act.id)); await reloadProject(projectId);
    }),
    addScene: (projectId: string, actNumber: number) => mutate(async () => {
      const project = projectById(projectId);
      const act = project.acts.find(item => item.act_number === actNumber);
      if (!act) throw new Error('Nie znaleziono aktu.');
      const saved = await api.scenes.create(Number(projectId), {
        act_id: Number(act.id), scene_number: Math.max(0, ...project.scenes.map(scene => scene.scene_number)) + 1,
        sort_order: project.scenes.filter(scene => scene.act === actNumber).length, title: 'Nowa scena',
      });
      await reloadProject(projectId); return String(saved.id);
    }),
    removeScene: (projectId: string, sceneId: string) => mutate(async () => {
      await api.scenes.delete(Number(sceneId)); past.current.delete(sceneId); future.current.delete(sceneId);
      await reloadProject(projectId);
    }),
    moveScene: (projectId: string, sceneId: string, actNumber: number) => mutate(async () => {
      const project = projectById(projectId);
      const act = project.acts.find(item => item.act_number === actNumber);
      if (!act) throw new Error('Nie znaleziono aktu.');
      await api.scenes.update(Number(sceneId), { act_id: Number(act.id), sort_order: project.scenes.filter(scene => scene.act === actNumber).length });
      await reloadProject(projectId);
    }),
    reorderScenes: (projectId: string, scenes: Scene[]) => mutate(async () => {
      for (let index = 0; index < scenes.length; index++) await api.scenes.update(Number(scenes[index].id), { sort_order: index });
      await reloadProject(projectId);
    }),
    saveCharacter: (projectId: string, character: Character) => mutate(async () => {
      const data = {
        name: character.name, age: character.age === '' ? null : Number(character.age), role: character.role,
        appearance: character.appearance, backstory: character.backstory, goals: character.goal,
        psychological_profile: character.flaw, voice_profile: { ...character.voice_profile, description: character.voice },
      };
      if (character.id) await api.characters.update(Number(character.id), data);
      else await api.characters.create(Number(projectId), data);
      await reloadProject(projectId);
    }),
    removeCharacter: (projectId: string, characterId: string) => mutate(async () => {
      await api.characters.delete(Number(characterId)); await reloadProject(projectId);
    }),
    applyVariant: (projectId: string, variantId: number) => mutate(async () => {
      await api.variants.select(variantId, { apply_to_scene: true });
      const project = await reloadProject(projectId);
      for (const scene of project.scenes) { past.current.delete(scene.id); future.current.delete(scene.id); }
      return project;
    }),
  };
}
