import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePromptHistory } from '../../src/hooks/usePromptHistory';
import { promptFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

describe('scene-specific prompt history', () => {
  it('loads each scene separately and ignores a late response from the previous scene', async () => {
    const old = deferred<Response>();
    const http = interceptHttp(call => call.path === '/scenes/20/prompts' ? old.promise :
      call.path === '/scenes/21/prompts' ? jsonResponse({ items: [promptFixture(21)], count: 1 }) : undefined);
    const { result, rerender } = renderHook(({ id }) => usePromptHistory('1', id), { initialProps: { id: '20' } });
    await waitFor(() => expect(http.calls).toHaveLength(1));
    rerender({ id: '21' });
    await waitFor(() => expect(result.current.entries[0]?.scene_id).toBe('21'));
    expect(http.calls[0].init.signal?.aborted).toBe(true);
    await act(async () => { old.resolve(jsonResponse({ items: [promptFixture(20)], count: 1 })); });
    expect(result.current.entries.map(entry => entry.prompt)).toEqual(['Prompt dla sceny 21']);
  });

  it('waits for persistence and reloads server-assigned IDs instead of adding an optimistic prompt', async () => {
    const save = deferred<Response>();
    let saved = false;
    const http = interceptHttp(call => {
      if (call.path !== '/scenes/20/prompts') return undefined;
      return call.method === 'POST' ? save.promise : jsonResponse({ items: saved ? [promptFixture()] : [], count: saved ? 1 : 0 });
    });
    const { result } = renderHook(() => usePromptHistory('1', '20'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => { pending = result.current.recordPrompt('Prompt dla sceny 20'); });
    expect(result.current.entries).toEqual([]);
    saved = true;
    await act(async () => { save.resolve(jsonResponse(promptFixture(), 201)); await pending; });
    await waitFor(() => expect(result.current.entries[0]?.id).toBe('50'));
    expect(http.calls.find(call => call.method === 'POST')?.body).toEqual({ user_prompt: 'Prompt dla sceny 20' });
  });

  it('does not invent history entries on a failed save', async () => {
    interceptHttp(call => call.path === '/scenes/20/prompts' ? call.method === 'POST' ? jsonResponse({}, 503) :
      jsonResponse({ items: [promptFixture()], count: 1 }) : undefined);
    const { result } = renderHook(() => usePromptHistory('1', '20'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => { await expect(result.current.recordPrompt('New prompt')).rejects.toHaveProperty('status', 503); });
    expect(result.current.entries).toHaveLength(1);
  });

  it('clears loading and history when the scene selection is removed during loading', async () => {
    const response = deferred<Response>();
    const http = interceptHttp(() => response.promise);
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => usePromptHistory('1', id), { initialProps: { id: '20' as string | undefined } });
    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ id: undefined });
    expect(result.current.loading).toBe(false);
    expect(result.current.entries).toEqual([]);
    await act(async () => { response.resolve(jsonResponse({ items: [promptFixture()], count: 1 })); });
    expect(http.calls).toHaveLength(1);
    expect(result.current.entries).toEqual([]);
    await expect(result.current.recordPrompt('No scene')).rejects.toThrow('Wybierz scenę');
  });

  it('reports a failed read and supports retry without local fallback', async () => {
    let fail = true;
    interceptHttp(() => fail ? jsonResponse({ detail: 'Unavailable' }, 503) : jsonResponse({ items: [promptFixture()], count: 1 }));
    const { result } = renderHook(() => usePromptHistory('1', '20'));
    await waitFor(() => expect(result.current.error).toBe('Unavailable'));
    expect(result.current.entries).toEqual([]);
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.error).toBe('');
  });
});
