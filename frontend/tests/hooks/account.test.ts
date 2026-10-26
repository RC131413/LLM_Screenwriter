import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePreferences } from '../../src/hooks/usePreferences';
import { useProfile } from '../../src/hooks/useProfile';
import { preferencesFixture, userFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

describe('persisted account and AI preferences', () => {
  it('loads preferences and uses the normalized server response for save and reset', async () => {
    const saved = preferencesFixture();
    saved.llm_preferences.temperature = 0.3;
    const http = interceptHttp(call => {
      if (call.path !== '/users/me/preferences') return undefined;
      if (call.method === 'GET') return jsonResponse(preferencesFixture());
      return jsonResponse(Object.keys(call.body as object).length ? saved : preferencesFixture());
    });
    const { result } = renderHook(() => usePreferences(1));
    await waitFor(() => expect(result.current.preferences?.llm_preferences.temperature).toBe(0.7));
    await act(async () => { await result.current.savePreferences(saved); });
    expect(result.current.preferences?.llm_preferences.temperature).toBe(0.3);
    await act(async () => { await result.current.resetPreferences(); });
    expect(result.current.preferences?.llm_preferences.temperature).toBe(0.7);
    expect(http.calls.filter(call => call.method === 'PUT').map(call => call.body)).toEqual([saved, {}]);
  });

  it('keeps confirmed preferences if saving fails', async () => {
    interceptHttp(call => call.method === 'GET' ? jsonResponse(preferencesFixture()) : jsonResponse({ detail: 'Invalid preferences' }, 422));
    const { result } = renderHook(() => usePreferences(1));
    await waitFor(() => expect(result.current.preferences).not.toBeNull());
    const next = preferencesFixture(); next.llm_preferences.temperature = 0.2;
    await act(async () => { await expect(result.current.savePreferences(next)).rejects.toHaveProperty('status', 422); });
    expect(result.current.preferences?.llm_preferences.temperature).toBe(0.7);
  });

  it('clears account-scoped preferences and loading after logout during a pending read', async () => {
    const response = deferred<Response>();
    interceptHttp(() => response.promise);
    const { result, rerender } = renderHook(({ id }: { id?: number }) => usePreferences(id), { initialProps: { id: 1 as number | undefined } });
    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ id: undefined });
    expect(result.current.loading).toBe(false);
    await act(async () => { response.resolve(jsonResponse(preferencesFixture())); });
    expect(result.current.preferences).toBeNull();
  });

  it('aborts the previous user read and never shows that user preferences for a new account', async () => {
    const old = deferred<Response>();
    let reads = 0;
    const next = preferencesFixture(); next.writing_style_preferences.dialogue_tone = 'Drugi użytkownik';
    const http = interceptHttp(() => ++reads === 1 ? old.promise : jsonResponse(next));
    const { result, rerender } = renderHook(({ id }) => usePreferences(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(reads).toBe(1));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.preferences?.writing_style_preferences.dialogue_tone).toBe('Drugi użytkownik'));
    await act(async () => { old.resolve(jsonResponse(preferencesFixture())); });
    expect(http.calls[0].init.signal?.aborted).toBe(true);
    expect(result.current.preferences?.writing_style_preferences.dialogue_tone).toBe('Drugi użytkownik');
  });

  it('saves username and profile separately, omits readonly email, then refreshes the account', async () => {
    const user = userFixture();
    const refresh = vi.fn(async () => user);
    const http = interceptHttp(call => jsonResponse(call.path === '/users/me' ? user : user.profile));
    const { result } = renderHook(() => useProfile(user, refresh));
    expect(result.current.profile).toMatchObject({ username: 'writer1', avatar_url: null, email: user.email });
    await act(async () => { await result.current.saveProfile({ username: 'new-name', display_name: 'Anna Nowa', avatar_url: null }); });
    expect(http.calls.map(call => [call.method, call.path, call.body])).toEqual([
      ['PATCH', '/users/me', { username: 'new-name' }],
      ['PATCH', '/users/me/profile', { display_name: 'Anna Nowa', avatar_url: '', preferred_language: 'pl' }],
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a partial profile failure and propagates the error to the form', async () => {
    const user = userFixture();
    const refresh = vi.fn(async () => user);
    interceptHttp(call => call.path === '/users/me' ? jsonResponse(user) : jsonResponse({ detail: 'Invalid avatar URL' }, 422));
    const { result } = renderHook(() => useProfile(user, refresh));
    await act(async () => {
      await expect(result.current.saveProfile({ username: 'new-name', display_name: 'Anna', avatar_url: 'invalid' })).rejects.toHaveProperty('status', 422);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
