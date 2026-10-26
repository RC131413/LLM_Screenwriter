import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSession } from '../../src/hooks/useSession';
import { api } from '../../src/services/api';
import { userFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

describe('session with the real API client', () => {
  it('bootstraps CSRF and restores the cookie session without local storage', async () => {
    const account = deferred<Response>();
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    const http = interceptHttp(call => call.path === '/users/me' ? account.promise : undefined);
    const { result } = renderHook(() => useSession());
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    await waitFor(() => expect(http.calls.map(call => call.path)).toEqual(['/auth/csrf', '/users/me']));
    await act(async () => { account.resolve(jsonResponse(userFixture())); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.email).toBe('writer1@example.com');
    expect(storage).not.toHaveBeenCalled();
    expect(http.calls.every(call => call.init.credentials === 'include' && call.init.cache === 'no-store')).toBe(true);
  });

  it('treats a missing session as anonymous, but lets the user retry a connection failure', async () => {
    let state: 'offline' | 'anonymous' | 'signed-in' = 'offline';
    interceptHttp(call => {
      if (call.path !== '/users/me') return undefined;
      if (state === 'offline') throw new TypeError('Failed to fetch');
      return state === 'anonymous' ? jsonResponse({ detail: 'Unauthorized' }, 401) : jsonResponse(userFixture());
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.error).toContain('Nie można połączyć'));
    state = 'anonymous';
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(result.current.user).toBeNull();
    state = 'signed-in';
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.user?.id).toBe(1));
  });

  it.each(['login', 'register'] as const)('only authenticates after successful %s and uses the rotated CSRF cookie', async operation => {
    const response = deferred<Response>();
    const http = interceptHttp(call => {
      if (call.path === '/users/me') return jsonResponse({}, 401);
      if (call.path === `/auth/${operation}`) return response.promise;
      if (call.path === '/users/me/preferences') return jsonResponse({});
      return undefined;
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const data = operation === 'login' ? { identifier: 'writer1@example.com', password: 'test-password' } :
      { username: 'writer1', email: 'writer1@example.com', password: 'test-password', password_confirm: 'test-password' };
    let pending!: Promise<void>;
    act(() => { pending = operation === 'login' ? result.current.login(data as Parameters<typeof api.auth.login>[0]) :
      result.current.register(data as Parameters<typeof api.auth.register>[0]); });
    expect(result.current.user).toBeNull();
    document.cookie = 'csrftoken=rotated-after-login; Path=/';
    await act(async () => { response.resolve(jsonResponse(userFixture(), operation === 'register' ? 201 : 200)); await pending; });
    expect(result.current.user?.id).toBe(1);
    await api.account.savePreferences({});
    const submission = http.calls.find(call => call.path === `/auth/${operation}`)!;
    expect(submission.body).toEqual(data);
    expect(submission.headers.get('X-CSRFToken')).toBe('test-csrf');
    expect(http.calls.at(-1)?.headers.get('X-CSRFToken')).toBe('rotated-after-login');
  });

  it('rejects invalid credentials without creating a user session', async () => {
    interceptHttp(call => call.path === '/users/me' || call.path === '/auth/login' ? jsonResponse({ detail: 'Invalid credentials' }, 401) : undefined);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await expect(result.current.login({ identifier: 'wrong', password: 'wrong' })).rejects.toHaveProperty('status', 401); });
    expect(result.current.user).toBeNull();
  });

  it('clears the account when another authenticated API request reports session expiry', async () => {
    interceptHttp(call => call.path === '/users/me' ? jsonResponse(userFixture()) : call.path === '/projects' ? jsonResponse({}, 401) : undefined);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.user?.id).toBe(1));
    await act(async () => { await expect(api.projects.list()).rejects.toHaveProperty('status', 401); });
    expect(result.current.user).toBeNull();
  });

  it('keeps the account if logout fails, then clears it and navigates after a confirmed logout', async () => {
    let fail = true;
    const http = interceptHttp(call => call.path === '/users/me' ? jsonResponse(userFixture()) :
      call.path === '/auth/logout' ? jsonResponse({ detail: 'Temporary failure' }, fail ? 503 : 200) : undefined);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.user?.id).toBe(1));
    await act(async () => { await expect(result.current.logout()).rejects.toHaveProperty('status', 503); });
    expect(result.current.user?.id).toBe(1);
    expect(result.current.loggingOut).toBe(false);
    fail = false;
    await act(async () => { await result.current.logout(); });
    expect(result.current.user).toBeNull();
    expect(location.hash).toBe('#login');
    expect(http.calls.filter(call => call.path === '/auth/logout').every(call => call.method === 'POST')).toBe(true);
  });

  it('waits for an in-flight password change before logging out', async () => {
    const password = deferred<Response>();
    const http = interceptHttp(call => call.path === '/users/me' ? jsonResponse(userFixture()) :
      call.path === '/users/me/password' ? password.promise : call.path === '/auth/logout' ? jsonResponse({ detail: 'OK' }) : undefined);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.user?.id).toBe(1));
    let change!: Promise<unknown>;
    let logout!: Promise<void>;
    act(() => {
      change = result.current.changePassword({ old_password: 'old', new_password: 'new-password', new_password_confirm: 'new-password' });
      logout = result.current.logout();
    });
    await waitFor(() => expect(http.calls.some(call => call.path === '/users/me/password')).toBe(true));
    expect(http.calls.some(call => call.path === '/auth/logout')).toBe(false);
    await act(async () => { password.resolve(jsonResponse({ detail: 'OK' })); await change; await logout; });
    expect(http.calls.slice(-2).map(call => call.path)).toEqual(['/users/me/password', '/auth/logout']);
    expect(result.current.user).toBeNull();
  });

  it('aborts session loading on unmount', async () => {
    const account = deferred<Response>();
    const http = interceptHttp(call => call.path === '/users/me' ? account.promise : undefined);
    const { unmount } = renderHook(() => useSession());
    await waitFor(() => expect(http.calls.some(call => call.path === '/users/me')).toBe(true));
    const signal = http.calls.find(call => call.path === '/users/me')!.init.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { account.resolve(jsonResponse(userFixture())); });
  });
});
