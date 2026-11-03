import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import { preferencesFixture, userFixture, variantFixture } from '../support/fixtures';
import { deferred, jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

describe('application → hooks → API client → HTTP', () => {
  it('restores a running generation after visiting statistics and reloading the editor', async () => {
    const response = deferred<Response>();
    let active: { scene_id: number; user_prompt: string; generation_id: string; variant_count: number } | null = null;
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (call.path === '/generation/active') return jsonResponse(active);
      if (call.path === '/scenes/20/generate') {
        active = { ...(call.body as NonNullable<typeof active>), scene_id: 20 };
        return response.promise;
      }
      if (call.path === '/scenes/20/cancel-generation') {
        active = null;
        return jsonResponse({ detail: 'Generowanie anulowane.' });
      }
      if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) {
        return jsonResponse({ items: [], count: 0 });
      }
      return undefined;
    });
    const mounted = render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    await user.type(await screen.findByLabelText('Kierunek sceny'), 'Pisz dalej');
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await waitFor(() => expect(active).not.toBeNull());
    await user.click(screen.getByRole('button', { name: /Menu użytkownika/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Ustawienia' }));
    await user.click(await screen.findByRole('tab', { name: 'Statystyki' }));
    await user.click(screen.getByRole('link', { name: 'Wróć do edytora' }));
    expect(await screen.findByLabelText('Kierunek sceny')).toHaveValue('Pisz dalej');
    expect(screen.getByRole('button', { name: 'Anuluj generowanie' })).toBeEnabled();
    const original = http.calls.find(call => call.path === '/scenes/20/generate')!;
    expect(original.init.signal?.aborted).toBe(false);

    mounted.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anuluj generowanie' })).toBeEnabled());
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Pisz dalej');
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Anuluj generowanie' }));
    expect(await screen.findByText('Generowanie anulowane.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
    expect(http.calls.find(call => call.path === '/scenes/20/cancel-generation')?.body)
      .toEqual({ user_prompt: 'Pisz dalej', generation_id: (original.body as { generation_id: string }).generation_id });
    expect(http.calls.filter(call => call.path === '/scenes/20/generate')).toHaveLength(1);
    await act(async () => { response.resolve(jsonResponse({ detail: 'Generowanie anulowane.' }, 409)); });
  });

  it('flushes editor changes, previews structured generation and applies it to the correct editor blocks', async () => {
    let generated = false;
    let sourceText = '';
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (call.path === '/scenes/20/generate') {
        sourceText = workspace.scenes[0].content_text; generated = true;
        return jsonResponse([variantFixture()], 201);
      }
      if (call.path === '/variants/70/select') {
        const variant = variantFixture();
        workspace.scenes[0].content_text += '\n\n' + variant.generated_full_text;
        const currentBlocks = workspace.scenes[0].editor_metadata.blocks;
        const continuation = variant.critic_metadata.blocks;
        workspace.scenes[0].editor_metadata = {
          ...workspace.scenes[0].editor_metadata,
          blocks: [...(Array.isArray(currentBlocks) ? currentBlocks : []), ...(Array.isArray(continuation) ? continuation : [])],
        };
        return jsonResponse({ ...variant, is_selected: true, applied_scene: workspace.scenes[0] });
      }
      if (call.path === '/scenes/20/variants') return jsonResponse({ items: generated ? [variantFixture()] : [], count: generated ? 1 : 0 });
      if (['/scenes/20/prompts', '/scenes/20/runs'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
      return undefined;
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    fireEvent.change(await screen.findByLabelText('Akcja 1'), { target: { value: 'Najnowszy tekst sceny.' } });
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Dodaj dialog');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    expect(await screen.findByRole('radio', { name: 'Wariant Bielika' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Podgląd tekstu' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Znalazłam list.');
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(sourceText).toBe('Najnowszy tekst sceny.');
    const writes = http.calls.filter(call => call.path === '/scenes/20' || call.path === '/scenes/20/generate');
    expect(writes.map(call => [call.method, call.path])).toEqual([['PATCH', '/scenes/20'], ['POST', '/scenes/20/generate']]);
    expect(writes[1].body).toEqual({ user_prompt: 'Dodaj dialog', generation_id: expect.any(String), variant_count: 1 });
    expect(screen.getByLabelText('Akcja 1')).toHaveValue('Najnowszy tekst sceny.');
    await user.click(screen.getByRole('button', { name: 'Zastosuj wybrany wariant' }));
    expect(await screen.findByLabelText('Postać 2')).toHaveValue('ANNA');
    expect(screen.getByLabelText('Dialog 3')).toHaveValue('Znalazłam list.');
    expect(screen.getByLabelText('Akcja 1')).toHaveValue('Najnowszy tekst sceny.');
    expect(http.workspace.scenes[0].content_text).toBe('Najnowszy tekst sceny.\n\n' + variantFixture().generated_full_text);
  });

  it('saves location and time separately from the visible heading field and restores them after remount', async () => {
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
      return undefined;
    });
    const mounted = render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    const heading = await screen.findByLabelText('Nagłówek sceny');
    expect(heading).toHaveAttribute('placeholder', 'Np. WN. DOM – RANO');
    expect(heading).toHaveAccessibleDescription('Po myślniku wpisz porę dnia, np. RANO, DZIEŃ lub NOC.');
    fireEvent.change(heading, { target: { value: 'PL. BIELSKO-BIAŁA – PRZYSTANEK – WIECZÓR' } });
    await waitFor(() => expect(http.workspace.scenes[0]).toMatchObject({
      location_heading: 'PL. BIELSKO-BIAŁA – PRZYSTANEK', time_of_day: 'WIECZÓR', content_text: 'ANNA czyta list.',
    }), { timeout: 2500 });
    const write = http.calls.find(call => call.method === 'PATCH')!;
    expect(write.body).toMatchObject({ location_heading: 'PL. BIELSKO-BIAŁA – PRZYSTANEK', time_of_day: 'WIECZÓR' });
    mounted.unmount();
    render(<App />);
    expect(await screen.findByLabelText('Nagłówek sceny')).toHaveValue('PL. BIELSKO-BIAŁA – PRZYSTANEK - WIECZÓR');
    fireEvent.change(screen.getByLabelText('Nagłówek sceny'), { target: { value: '' } });
    await waitFor(() => expect(http.workspace.scenes[0]).toMatchObject({ location_heading: '', time_of_day: '' }), { timeout: 2500 });
    expect(screen.getByLabelText('Akcja 1')).toHaveValue('ANNA czyta list.');
  });

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
