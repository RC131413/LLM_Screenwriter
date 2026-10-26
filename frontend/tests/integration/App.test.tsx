import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import { preferencesFixture, userFixture } from '../support/fixtures';
import { deferred, jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

describe('application → hooks → API client → HTTP', () => {
  it('logs in, loads persistent dashboard data and logs out through the server', async () => {
    let authenticated = false;
    const http = workspaceHttp(call => {
      if (call.path === '/users/me') return authenticated ? jsonResponse(userFixture()) : jsonResponse({}, 401);
      if (call.path === '/auth/login') { authenticated = true; return jsonResponse(userFixture()); }
      if (call.path === '/auth/logout') { authenticated = false; return jsonResponse({ detail: 'OK' }); }
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      return undefined;
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Zaloguj się' });
    expect(http.calls.some(call => call.path === '/projects')).toBe(false);
    await user.type(screen.getByLabelText('E-mail lub nazwa użytkownika'), 'writer1');
    await user.type(screen.getByLabelText('Hasło', { exact: true }), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByRole('article', { name: 'Nocny pociąg' })).toBeInTheDocument();
    await waitFor(() => expect(location.hash).toBe('#projects'));
    await user.click(screen.getByRole('button', { name: 'Menu użytkownika: Anna' }));
    await user.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    expect(await screen.findByRole('heading', { name: 'Zaloguj się' })).toBeInTheDocument();
    expect(location.hash).toBe('#login');
    const logout = http.calls.find(call => call.path === '/auth/logout')!;
    expect(logout).toMatchObject({ method: 'POST', init: { credentials: 'include' } });
    expect(logout.headers.get('X-CSRFToken')).toBe('test-csrf');
  });

  it('keeps the editor and unsaved text after an in-flight save fails during logout, then permits retry', async () => {
    const pendingSave = deferred<Response>();
    let holdSave = true;
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
      if (call.path === '/scenes/20' && call.method === 'PATCH' && holdSave) return pendingSave.promise;
      if (call.path === '/auth/logout') return jsonResponse({ detail: 'OK' });
      return undefined;
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    const text = await screen.findByLabelText('Akcja 1');
    fireEvent.change(text, { target: { value: 'Ważny niezapisany tekst.' } });
    await waitFor(() => expect(http.calls.some(call => call.method === 'PATCH')).toBe(true), { timeout: 2500 });
    await user.click(screen.getByRole('button', { name: 'Menu użytkownika: Anna' }));
    await user.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await act(async () => { pendingSave.resolve(jsonResponse({ detail: 'Save unavailable' }, 503)); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('Akcja 1')).toHaveValue('Ważny niezapisany tekst.');
    expect(http.calls.some(call => call.path === '/auth/logout')).toBe(false);
    holdSave = false;
    await user.click(screen.getByRole('button', { name: 'Ponów zapis / odśwież' }));
    await waitFor(() => expect(http.workspace.scenes[0].content_text).toBe('Ważny niezapisany tekst.'));
    await user.click(screen.getByRole('button', { name: 'Menu użytkownika: Anna' }));
    await user.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    expect(await screen.findByRole('heading', { name: 'Zaloguj się' })).toBeInTheDocument();
  });
});
