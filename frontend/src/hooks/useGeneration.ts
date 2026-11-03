import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { ApiActiveGeneration } from '../services/api';
import { errorMessage } from '../services/workspaceData';

type Draft = { prompt: string; count: 1 | 2 | 3 };
type Feedback = { error?: string; notice?: string };
type Submission = { job: ApiActiveGeneration; controller: AbortController; submitted: boolean };
const emptyDraft: Draft = { prompt: '', count: 1 };

const draftKey = (userId: number | undefined, sceneId: number) => `agentdraft.prompt.${userId}.${sceneId}`;

export function useGeneration(userId: number | undefined) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [feedback, setFeedback] = useState<Record<number, Feedback>>({});
  const [versions, setVersions] = useState<Record<number, number>>({});
  const [remote, setRemote] = useState<ApiActiveGeneration | null>(null);
  const [local, setLocal] = useState<ApiActiveGeneration | null>(null);
  const [cancellingJob, setCancellingJob] = useState<ApiActiveGeneration | null>(null);
  const [checking, setChecking] = useState(true);
  const submission = useRef<Submission | null>(null);
  const cancellation = useRef<string | null>(null);
  const polling = useRef<(() => void) | null>(null);

  function refreshScene(id: number) {
    setVersions(current => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  useEffect(() => {
    setDrafts({}); setFeedback({}); setVersions({}); setRemote(null); setLocal(null); setCancellingJob(null);
    setChecking(true);
    if (userId === undefined) return;
    const controller = new AbortController();
    let previous: ApiActiveGeneration | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let loading = false;
    async function poll() {
      if (loading || controller.signal.aborted) return;
      clearTimeout(timer);
      loading = true;
      try {
        const current = await api.runs.active({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (previous && previous.generation_id !== current?.generation_id) refreshScene(previous.scene_id);
        if (current && current.generation_id !== previous?.generation_id) {
          setDrafts(drafts => ({ ...drafts, [current.scene_id]: { prompt: current.user_prompt, count: current.variant_count } }));
          sessionStorage.setItem(draftKey(userId, current.scene_id), current.user_prompt);
        }
        previous = current;
        setRemote(current);
      } catch {
        // Keep the last known job on connection loss and recover on the next poll.
      } finally {
        loading = false;
        if (!controller.signal.aborted) {
          setChecking(false);
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    }
    polling.current = () => void poll();
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      submission.current?.controller.abort();
      submission.current = null;
      cancellation.current = null;
      polling.current = null;
    };
  }, [userId]);

  const active = cancellingJob ?? local ?? remote;
  function draftFor(sceneId: number): Draft {
    if (active?.scene_id === sceneId) return { prompt: active.user_prompt, count: active.variant_count };
    if (drafts[sceneId]) return drafts[sceneId];
    return { ...emptyDraft, prompt: sessionStorage.getItem(draftKey(userId, sceneId)) ?? '' };
  }

  async function start(sceneId: number, prepare: () => Promise<void>) {
    const draft = draftFor(sceneId);
    if (checking || active || submission.current || !draft.prompt.trim()) return;
    const job: ApiActiveGeneration = {
      scene_id: sceneId, generation_id: crypto.randomUUID(), user_prompt: draft.prompt.trim(), variant_count: draft.count,
    };
    const operation = { job, controller: new AbortController(), submitted: false };
    submission.current = operation;
    setLocal(job);
    sessionStorage.setItem(draftKey(userId, sceneId), job.user_prompt);
    setFeedback(current => ({ ...current, [sceneId]: {} }));
    try {
      await prepare();
      operation.controller.signal.throwIfAborted();
      operation.submitted = true;
      await api.scenes.generate(sceneId, {
        generation_id: job.generation_id, user_prompt: job.user_prompt, variant_count: job.variant_count,
      }, { signal: operation.controller.signal });
    } catch (failure) {
      if (!operation.controller.signal.aborted) setFeedback(current => ({ ...current, [sceneId]: { error: errorMessage(failure) } }));
    } finally {
      if (submission.current === operation) {
        submission.current = null;
        setLocal(null);
        refreshScene(sceneId);
        polling.current?.();
      }
    }
  }

  async function cancel() {
    if (!active || cancellation.current) return;
    const { scene_id: id, generation_id, user_prompt } = active;
    const operation = submission.current;
    cancellation.current = generation_id;
    setCancellingJob(active);
    try {
      const message = operation?.job.generation_id === generation_id && !operation.submitted
        ? { detail: 'Generowanie anulowane.' }
        : await api.scenes.cancelGeneration(id, { generation_id, user_prompt });
      if (cancellation.current !== generation_id) return;
      if (operation && submission.current === operation && operation.job.generation_id === generation_id) {
        operation.controller.abort();
        submission.current = null;
        setLocal(null);
      }
      setRemote(current => current?.generation_id === generation_id ? null : current);
      setFeedback(current => ({ ...current, [id]: { notice: message.detail } }));
      refreshScene(id);
    } catch (failure) {
      if (cancellation.current === generation_id) {
        setFeedback(current => ({ ...current, [id]: { error: `Nie udało się potwierdzić anulowania. ${errorMessage(failure)}` } }));
      }
    } finally {
      if (cancellation.current === generation_id) {
        cancellation.current = null;
        setCancellingJob(null);
        polling.current?.();
      }
    }
  }

  return {
    active, cancelling: Boolean(cancellingJob), checking, start, cancel, feedback, versions,
    draft: draftFor,
    edit: (id: number, changes: Partial<Draft>) => {
      const draft = draftFor(id);
      setDrafts(current => ({ ...current, [id]: { ...draft, ...current[id], ...changes } }));
    },
  };
}
