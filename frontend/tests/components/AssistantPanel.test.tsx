import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantPanel } from '../../src/components/AssistantPanel';
import { toProject } from '../../src/services/workspaceData';
import { promptFixture, variantFixture, workspaceFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

const project = () => toProject(workspaceFixture());
const props = () => {
  const data = project();
  return { project: data, scene: data.scenes[0], onSelect: vi.fn(), onChange: vi.fn(), onPrepare: vi.fn(async () => {}), onApply: vi.fn(async () => {}), onClose: vi.fn() };
};

describe('assistant using stored backend data', () => {
  it('loads history for the current scene and inserts the selected prompt into the input', async () => {
    const http = interceptHttp(call => call.path === '/scenes/20/prompts' ? jsonResponse({ items: [promptFixture()], count: 1 }) :
      ['/scenes/20/variants', '/scenes/20/runs'].includes(call.path) ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...props()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Historia promptów' }));
    await user.click(await screen.findByRole('button', { name: 'Użyj promptu 1: Prompt dla sceny 20' }));
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Prompt dla sceny 20');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(http.calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('waits for scene persistence, generates once and displays the returned variant', async () => {
    const preparation = deferred<void>();
    const generation = deferred<Response>();
    let generated = false;
    const component = props(); component.onPrepare = vi.fn(() => preparation.promise);
    const http = interceptHttp(call => {
      if (call.path === '/scenes/20/generate') return generation.promise;
      if (call.path === '/scenes/20/variants') return jsonResponse({ items: generated ? [variantFixture()] : [], count: generated ? 1 : 0 });
      if (call.path === '/scenes/20/prompts') return jsonResponse({ items: generated ? [promptFixture()] : [], count: generated ? 1 : 0 });
      return call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined;
    });
    render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), ' Więcej napięcia ');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    expect(component.onPrepare).toHaveBeenCalledTimes(1);
    expect(http.calls.some(call => call.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Kierunek sceny')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generowanie...' })).toBeDisabled();
    expect(screen.getByText('Generowanie... Oczekiwanie na odpowiedź Bielika.')).toHaveAttribute('role', 'status');
    await act(async () => { preparation.resolve(); });
    await waitFor(() => expect(http.calls.some(call => call.path === '/scenes/20/generate')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Generowanie...' }));
    expect(http.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
    generated = true;
    await act(async () => { generation.resolve(jsonResponse(variantFixture(), 201)); });
    expect(await screen.findByRole('region', { name: 'Wynik generowania' })).toHaveTextContent('Znalazłam list.');
    expect(http.calls.filter(call => call.method !== 'GET').map(call => [call.path, call.body])).toEqual([
      ['/scenes/20/generate', { user_prompt: 'Więcej napięcia' }],
    ]);
    expect(http.calls.find(call => call.method === 'POST')?.headers.get('X-CSRFToken')).toBe('test-csrf');
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Zastosuj wybrany wariant' }));
    expect(component.onApply).toHaveBeenCalledWith(70);
  });

  it('blocks prompt submission if the pending scene save fails and retains the prompt draft', async () => {
    const component = props(); component.onPrepare.mockRejectedValueOnce(new Error('Zapis sceny nie powiódł się.'));
    const http = interceptHttp(call => call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Nowy kierunek');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Zapis sceny nie powiódł się.'));
    expect(http.calls.some(call => call.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Nowy kierunek');
  });

  it('shows an Ollama error, retains the prompt and re-enables retry without inventing a result', async () => {
    interceptHttp(call => call.path === '/scenes/20/generate' ? jsonResponse({ detail: 'Ollama jest niedostępna.' }, 503) :
      call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...props()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Dodaj dialog');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ollama jest niedostępna.');
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Dodaj dialog');
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
  });

  it('does not display an old scene response after the user switches scenes while generating', async () => {
    const generation = deferred<Response>();
    const http = interceptHttp(call => call.path === '/scenes/20/generate' ? generation.promise :
      call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    const component = props();
    const { rerender } = render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Zmień scenę');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await waitFor(() => expect(http.calls.some(call => call.method === 'POST')).toBe(true));
    rerender(<AssistantPanel {...component} scene={{ ...component.scene, id: '21', title: 'Druga scena' }} />);
    expect(http.calls.find(call => call.method === 'POST')?.init.signal?.aborted).toBe(true);
    await act(async () => { generation.resolve(jsonResponse(variantFixture(), 201)); });
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('');
    expect(screen.queryByText('Znalazłam list.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
  });
});
