import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../src/hooks/useWorkspace';
import type { ApiWorkspace } from '../../src/services/api';
import { toCharacter } from '../../src/services/workspaceData';
import { characterFixture } from '../support/fixtures';
import { deferred, jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

async function loadedWorkspace() {
  const hook = renderHook(() => useWorkspace(1));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.loadError).toBe('');
  return hook;
}

describe('workspace loading and API confirmation', () => {
  it('hydrates all dashboard collections and deduplicates projects across collections', async () => {
    const http = workspaceHttp((call, workspace) => call.path === '/projects' ? jsonResponse({ items: [workspace.project], count: 1 }) : undefined);
    const { result } = await loadedWorkspace();
    expect(result.current.projects.map(project => project.id)).toEqual(['1']);
    expect(http.calls.filter(call => call.path === '/projects').map(call => call.url.searchParams.get('collection'))).toEqual(['all', 'archive', 'trash']);
    expect(http.calls.filter(call => call.path.endsWith('/workspace'))).toHaveLength(1);
    expect(result.current.projects[0].scenes[0].blocks[0].text).toBe('ANNA czyta list.');
  });

  it('shows load errors and refetches when retrying instead of using sample projects', async () => {
    let fail = true;
    workspaceHttp(call => call.path.endsWith('/workspace') && fail ? jsonResponse({ detail: 'Workspace unavailable' }, 503) : undefined);
    const { result } = renderHook(() => useWorkspace(1));
    await waitFor(() => expect(result.current.loadError).toBe('Workspace unavailable'));
    expect(result.current.projects).toEqual([]);
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.loadError).toBe('');
  });

  it('clears projects and ignores old hydration when the account logs out', async () => {
    const response = deferred<Response>();
    const http = workspaceHttp(call => call.path.endsWith('/workspace') ? response.promise : undefined);
    const { result, rerender } = renderHook(({ id }: { id?: number }) => useWorkspace(id), { initialProps: { id: 1 as number | undefined } });
    await waitFor(() => expect(http.calls.some(call => call.path.endsWith('/workspace'))).toBe(true));
    rerender({ id: undefined });
    await act(async () => { response.resolve(jsonResponse(http.workspace)); });
    expect(result.current.projects).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('retains a project when deletion fails and removes it only after server confirmation', async () => {
    let fail = true;
    const http = workspaceHttp(call => call.method === 'DELETE' && call.path === '/projects/1' ?
      fail ? jsonResponse({ detail: 'Deletion failed' }, 503) : new Response(null, { status: 204 }) : undefined);
    const { result } = await loadedWorkspace();
    await act(async () => { await expect(result.current.removeProject('1')).rejects.toHaveProperty('status', 503); });
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.saveState).toBe('error');
    fail = false;
    await act(async () => { await result.current.removeProject('1'); });
    expect(result.current.projects).toEqual([]);
    expect(http.calls.filter(call => call.method === 'DELETE')).toHaveLength(2);
  });
});

describe('scene autosave and cast', () => {
  it('debounces rapid edits into one PATCH and preserves metadata', async () => {
    const http = workspaceHttp();
    const { result } = await loadedWorkspace();
    vi.useFakeTimers();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Pierwsza zmiana' }));
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Ostatnia zmiana', notes: 'Pauza' }));
    expect(result.current.saveState).toBe('saving');
    await act(async () => { await vi.advanceTimersByTimeAsync(599); });
    expect(http.calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await result.current.flush(); });
    const writes = http.calls.filter(call => call.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ title: 'Ostatnia zmiana', ai_metadata: { notes: 'Pauza', custom_ai: { preserve: true } }, editor_metadata: { zoom: 120 } });
    expect(result.current.saveState).toBe('saved');
  });

  it('saves editor content, removes deselected cast and creates newly selected cast without rewriting unchanged members', async () => {
    const http = workspaceHttp(call => {
      if (call.path === '/cast/40' && call.method === 'DELETE') return new Response(null, { status: 204 });
      if (call.path === '/scenes/20/cast' && call.method === 'POST') return jsonResponse({ id: 41, character_id: 31 }, 201);
      return undefined;
    });
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], characterIds: ['31'], blocks: [{ id: 'new', type: 'dialogue', text: 'Poczekaj.' }] }));
    await act(async () => { await result.current.flush(); });
    expect(http.calls.filter(call => call.method !== 'GET').map(call => [call.method, call.path])).toEqual([
      ['PATCH', '/scenes/20'], ['DELETE', '/cast/40'], ['POST', '/scenes/20/cast'],
    ]);
    expect(http.calls.find(call => call.method === 'POST')?.body).toEqual({ character_id: 31 });
    expect(http.workspace.scenes[0].content_text).toBe('Poczekaj.');
  });

  it('keeps a failed draft and retries it, including a partially failed cast update', async () => {
    let fail = true;
    const http = workspaceHttp(call => {
      if (call.path === '/scenes/20/cast') return fail ? jsonResponse({ detail: 'Cast unavailable' }, 503) : jsonResponse({ id: 41 }, 201);
      return undefined;
    });
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Niezapisana obsada', characterIds: ['30', '31'] }));
    await act(async () => { await expect(result.current.flush()).rejects.toHaveProperty('status', 503); });
    expect(result.current.projects[0].scenes[0].title).toBe('Niezapisana obsada');
    expect(result.current.saveState).toBe('error');
    fail = false;
    await act(async () => { await result.current.flush(); });
    expect(result.current.saveState).toBe('saved');
    expect(http.calls.filter(call => call.path === '/cast/40')).toHaveLength(0);
    expect(http.calls.filter(call => call.path === '/scenes/20/cast')).toHaveLength(2);
  });

  it('never allows flush to report success while an in-flight autosave fails', async () => {
    const save = deferred<Response>();
    const http = workspaceHttp(call => call.path === '/scenes/20' ? save.promise : undefined);
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Ważna zmiana' }));
    // First flush models the running autosave; the second models navigation/logout.
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.flush().catch(error => error);
      second = result.current.flush().then(() => 'incorrect-success', error => error);
    });
    await waitFor(() => expect(http.calls.some(call => call.method === 'PATCH')).toBe(true));
    let outcome: unknown;
    await act(async () => { save.resolve(jsonResponse({ detail: 'Save failed' }, 503)); await first; outcome = await second; });
    expect(outcome).toHaveProperty('status', 503);
    expect(result.current.saveState).toBe('error');
  });

  it('persists undo and redo through the same save path', async () => {
    const http = workspaceHttp();
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Zmieniony tytuł' }));
    expect(result.current.canUndo('20')).toBe(true);
    act(() => result.current.undo('20'));
    await act(async () => { await result.current.flush(); });
    expect(http.workspace.scenes[0].title).toBe('List');
    expect(result.current.canRedo('20')).toBe(true);
    act(() => result.current.redo('20'));
    await act(async () => { await result.current.flush(); });
    expect(http.workspace.scenes[0].title).toBe('Zmieniony tytuł');
  });

  it('serializes overlapping saves so the newest text reaches the server last', async () => {
    const firstResponse = deferred<Response>();
    let writes = 0;
    const http = workspaceHttp(call => call.path === '/scenes/20' && ++writes === 1 ? firstResponse.promise : undefined);
    const { result } = await loadedWorkspace();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Wersja pierwsza' });
      first = result.current.flush();
    });
    await waitFor(() => expect(writes).toBe(1));
    act(() => {
      result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Wersja najnowsza' });
      second = result.current.flush();
    });
    expect(writes).toBe(1);
    await act(async () => {
      firstResponse.resolve(jsonResponse({ ...http.workspace.scenes[0], title: 'Wersja pierwsza' }));
      await first; await second;
    });
    expect(http.calls.filter(call => call.method === 'PATCH').map(call => (call.body as { title: string }).title))
      .toEqual(['Wersja pierwsza', 'Wersja najnowsza']);
    expect(http.workspace.scenes[0].title).toBe('Wersja najnowsza');
    expect(result.current.saveState).toBe('saved');
  });

  it('does not overwrite a newer pending draft when an older save fails', async () => {
    const firstResponse = deferred<Response>();
    let failFirst = true;
    const http = workspaceHttp(call => call.path === '/scenes/20' && failFirst ? firstResponse.promise : undefined);
    const { result } = await loadedWorkspace();
    let first!: Promise<unknown>;
    act(() => {
      result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Starszy szkic' });
      first = result.current.flush().catch(error => error);
    });
    await waitFor(() => expect(http.calls.some(call => call.method === 'PATCH')).toBe(true));
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Nowszy szkic' }));
    await act(async () => { firstResponse.resolve(jsonResponse({}, 503)); await first; });
    failFirst = false;
    await act(async () => { await result.current.flush(); });
    expect(http.workspace.scenes[0].title).toBe('Nowszy szkic');
  });

  it('warns before closing a tab with an unsaved draft and stops warning after persistence', async () => {
    workspaceHttp();
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], title: 'Do zapisania' }));
    const unsaved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
    await act(async () => { await result.current.flush(); });
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
});

describe('structure, characters and generated variants', () => {
  it('flushes the scene before moving it and sends the target act ID without deleting text', async () => {
    const http = workspaceHttp();
    const { result } = await loadedWorkspace();
    act(() => result.current.updateScene({ ...result.current.projects[0].scenes[0], notes: 'Przed przeniesieniem' }));
    await act(async () => { await result.current.moveScene('1', '20', 2); });
    const writes = http.calls.filter(call => call.method === 'PATCH');
    expect(writes.map(call => call.body)).toEqual([
      expect.objectContaining({ ai_metadata: expect.objectContaining({ notes: 'Przed przeniesieniem' }) }),
      { act_id: 11, sort_order: 0 },
    ]);
    expect(result.current.projects[0].scenes[0]).toMatchObject({ act: 2, notes: 'Przed przeniesieniem' });
  });

  it('blocks deleting nonempty acts and updates act metadata through PATCH', async () => {
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/acts/10' && call.method === 'PATCH') { Object.assign(workspace.acts[0], call.body); return jsonResponse(workspace.acts[0]); }
      return undefined;
    });
    const { result } = await loadedWorkspace();
    const actToEdit = result.current.projects[0].acts[0];
    await act(async () => { await expect(result.current.removeAct('1', actToEdit)).rejects.toThrow('Przenieś lub usuń sceny'); });
    expect(http.calls.some(call => call.method === 'DELETE')).toBe(false);
    await act(async () => { await result.current.editAct('1', { ...actToEdit, title: 'Prolog', summary: 'List zostaje odnaleziony.' }); });
    expect(http.calls.find(call => call.method === 'PATCH')?.body).toEqual({ title: 'Prolog', summary: 'List zostaje odnaleziony.' });
    expect(result.current.projects[0].acts[0].title).toBe('Prolog');
  });

  it('maps character fields to ERD names and preserves voice metadata', async () => {
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/characters/30' && call.method === 'PATCH') { Object.assign(workspace.characters[0], call.body); return jsonResponse(workspace.characters[0]); }
      return undefined;
    });
    const { result } = await loadedWorkspace();
    const character = toCharacter(characterFixture());
    await act(async () => { await result.current.saveCharacter('1', { ...character, appearance: 'Czarny płaszcz', backstory: 'Nowa historia', voice: 'Szept' }); });
    expect(http.calls.find(call => call.method === 'PATCH')?.body).toMatchObject({
      age: null, goals: 'Odnaleźć list', psychological_profile: 'Nieufność', appearance: 'Czarny płaszcz', backstory: 'Nowa historia',
      voice_profile: { tone: 'Spokojny', custom: true, description: 'Szept' },
    });
    expect(result.current.projects[0].characters[0].backstory).toBe('Nowa historia');
  });

  it('applies a stored variant through the select endpoint and reloads the actual text', async () => {
    const http = workspaceHttp((call, workspace: ApiWorkspace) => {
      if (call.path === '/variants/70/select') {
        workspace.scenes[0].content_text = 'Tekst wariantu'; workspace.scenes[0].editor_metadata = {};
        return jsonResponse({ id: 70, is_selected: true });
      }
      return undefined;
    });
    const { result } = await loadedWorkspace();
    await act(async () => { await result.current.applyVariant('1', 70); });
    expect(http.calls.find(call => call.path === '/variants/70/select')?.body).toEqual({ apply_to_scene: true });
    expect(result.current.projects[0].scenes[0].blocks[0].text).toBe('Tekst wariantu');
    expect(result.current.canUndo('20')).toBe(false);
  });
});
