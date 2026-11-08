import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { preferencesFixture, userFixture } from '../support/fixtures';
import { deferred, jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const createUrl = vi.fn((_object: Blob | MediaSource) => 'blob:export-test');
let click: ReturnType<typeof vi.spyOn>;
let filename: string;
beforeEach(() => {
  filename = '';
  createUrl.mockClear();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = vi.fn();
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
});
afterEach(() => { click.mockRestore(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });

function httpForExport(override?: Parameters<typeof workspaceHttp>[0]) {
  return workspaceHttp((call, workspace) => {
    const response = override?.(call, workspace);
    if (response !== undefined) return response;
    if (call.path === '/users/me') return jsonResponse(userFixture());
    if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
    if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
    if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
    if (call.path === '/projects/1/export') return new Response('screenplay', { headers: {
      'Content-Disposition': `attachment; filename="film.${call.url.searchParams.get('format')}"`,
    } });
    return undefined;
  });
}

async function openExport() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
  await user.click(await screen.findByRole('button', { name: 'Eksportuj' }));
  return user;
}

describe('project exports', () => {
  it.each(['fountain', 'fdx', 'pdf'])('downloads %s from the authenticated backend', async format => {
    const http = httpForExport();
    render(<App />);
    const user = await openExport();
    await user.selectOptions(screen.getByLabelText('Format pliku'), format);
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(filename).toBe(`film.${format}`);
    expect(http.calls.find(call => call.path === '/projects/1/export')?.init.credentials).toBe('include');
    expect(screen.queryByRole('dialog', { name: 'Eksport scenariusza' })).not.toBeInTheDocument();
  });

  it('waits for the latest editor save and prevents duplicate downloads while waiting', async () => {
    const save = deferred<Response>();
    const http = httpForExport((call, workspace) => {
      if (call.path === '/scenes/20' && call.method === 'PATCH') {
        Object.assign(workspace.scenes[0], call.body);
        return save.promise;
      }
      return undefined;
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    const action = await screen.findByDisplayValue('ANNA czyta list.');
    await user.type(action, ' Nowe zdanie.');
    await user.click(screen.getByRole('button', { name: 'Eksportuj' }));
    await user.selectOptions(screen.getByLabelText('Format pliku'), 'pdf');
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    expect(await screen.findByRole('button', { name: 'Przygotowywanie pliku…' })).toBeDisabled();
    expect(http.calls.some(call => call.path === '/projects/1/export')).toBe(false);
    await act(async () => { save.resolve(jsonResponse(http.workspace.scenes[0])); });
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(http.calls.filter(call => call.path === '/projects/1/export')).toHaveLength(1);
    expect(http.workspace.scenes[0].content_text).toContain('Nowe zdanie.');
  });

  it('keeps download errors in the dialog and lets the user retry', async () => {
    let failed = true;
    httpForExport(call => call.path === '/projects/1/export' && failed ? jsonResponse({ detail: 'Eksport chwilowo niedostępny.' }, 503) : undefined);
    render(<App />);
    const user = await openExport();
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Eksport chwilowo niedostępny.');
    expect(click).not.toHaveBeenCalled();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
  });

  it('does not export an older scene when saving the current changes fails', async () => {
    const http = httpForExport(call => call.path === '/scenes/20' && call.method === 'PATCH'
      ? jsonResponse({ detail: 'Zapis sceny nie powiódł się.' }, 503) : undefined);
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    await user.type(await screen.findByDisplayValue('ANNA czyta list.'), ' Zmiana.');
    await user.click(screen.getByRole('button', { name: 'Eksportuj' }));
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Eksport scenariusza' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Zapis sceny nie powiódł się.');
    expect(click).not.toHaveBeenCalled();
    expect(http.calls.some(call => call.path === '/projects/1/export')).toBe(false);
  });

  it('retains full JSON project export including character profiles', async () => {
    const http = httpForExport();
    render(<App />);
    const user = await openExport();
    await user.selectOptions(screen.getByLabelText('Format pliku'), 'json');
    await user.click(screen.getByRole('button', { name: 'Pobierz plik' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(filename).toBe('nocny-pociąg.json');
    expect(http.calls.filter(call => call.path === '/projects/1/workspace')).toHaveLength(2);
    expect(http.calls.some(call => call.path === '/projects/1/export')).toBe(false);
    const blob = createUrl.mock.calls[0][0] as Blob;
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
      reader.readAsText(blob);
    });
    const project = JSON.parse(content);
    expect(project.characters.map((character: { name: string }) => character.name)).toContain('ANNA');
    expect(project.scenes[0].blocks[0].text).toBe('ANNA czyta list.');
  });
});
