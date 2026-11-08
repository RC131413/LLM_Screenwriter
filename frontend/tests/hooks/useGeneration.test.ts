import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGeneration } from '../../src/hooks/useGeneration';
import { activeFixture, executionFixture, progressFixture } from '../support/generation';
import { deferred, interceptHttp, jsonResponse } from '../support/http';
import type { ApiActiveGeneration } from '../../src/services/api';

describe('global live generation polling', () => {
  it('polls active work every second and recovers from a temporary status-read error', async () => {
    vi.useFakeTimers();
    let active = activeFixture(); let fail = false;
    const http = interceptHttp(() => fail ? jsonResponse({ detail: 'Offline' }, 503) : jsonResponse(active));
    const { result } = renderHook(() => useGeneration(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.active?.progress?.percent).toBe(0);
    active = activeFixture(progressFixture({ percent: 25, completed_steps: 1,
      agent_executions: [executionFixture('archivist', 'completed'), executionFixture('director')] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.active?.progress?.percent).toBe(25);
    expect(http.calls).toHaveLength(2);
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.active?.progress?.percent).toBe(25);
    expect(result.current.progressError).toContain('Ponawiam');
    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.progressError).toBe('');
  });

  it('does not resurrect a cancelled job from a status response already in flight', async () => {
    vi.useFakeTimers();
    const read = deferred<Response>(); const post = deferred<Response>();
    let pollCount = 0;
    let payload: ApiActiveGeneration | undefined;
    interceptHttp(call => {
      if (call.path === '/generation/active') return ++pollCount === 1 ? jsonResponse(null) : read.promise;
      if (call.path === '/scenes/20/generate') {
        payload = { ...activeFixture(), ...(call.body as ApiActiveGeneration), scene_id: 20 };
        return post.promise;
      }
      if (call.path === '/scenes/20/cancel-generation') return jsonResponse({ detail: 'Anulowano.' });
      return undefined;
    });
    const { result } = renderHook(() => useGeneration(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => result.current.edit(20, { prompt: 'Anna otwiera list.' }));
    let submission!: Promise<void>;
    await act(async () => { submission = result.current.start(20, async () => {}); await vi.advanceTimersByTimeAsync(0); });
    expect(payload).toBeDefined();
    await act(async () => { await result.current.cancel(); });
    expect(result.current.active).toBeNull();
    await act(async () => { read.resolve(jsonResponse(payload)); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.active).toBeNull();
    await act(async () => { post.resolve(jsonResponse({ detail: 'Anulowano.' }, 409)); await submission; });
    expect(result.current.active).toBeNull();
  });
});
