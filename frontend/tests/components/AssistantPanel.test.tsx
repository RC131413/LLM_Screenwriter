import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantPanel as Panel } from '../../src/components/AssistantPanel';
import { useGeneration } from '../../src/hooks/useGeneration';
import type { ComponentProps } from 'react';
import { toProject } from '../../src/services/workspaceData';
import { promptFixture, variantFixture, workspaceFixture } from '../support/fixtures';
import { deferred, interceptHttp as intercept, jsonResponse } from '../support/http';

const interceptHttp = (handle: Parameters<typeof intercept>[0]) =>
  intercept(call => call.path === '/generation/active' ? jsonResponse(null) : handle(call));

function AssistantPanel(props: Omit<ComponentProps<typeof Panel>, 'generation'>) {
  const generation = useGeneration(1);
  return <Panel {...props} generation={generation} />;
}

const project = () => toProject(workspaceFixture());
const props = () => {
  const data = project();
  return { project: data, scene: data.scenes[0], onSelect: vi.fn(), onChange: vi.fn(), onPrepare: vi.fn(async () => {}), onApply: vi.fn(async () => {}), onClose: vi.fn() };
};

describe('assistant using stored backend data', () => {
  it('hides a previous result after reloading a scene whose latest run was cancelled', async () => {
    interceptHttp(call => {
      if (call.path === '/scenes/20/variants') return jsonResponse({ items: [variantFixture()], count: 1 });
      if (call.path === '/scenes/20/runs') return jsonResponse({ items: [{ id: 61 }], count: 1 });
      if (call.path === '/runs/61') return jsonResponse({ id: 61, status: 'cancelled', agent_executions: [], variants: [], error_message: '' });
      return jsonResponse({ items: [], count: 0 });
    });
    render(<AssistantPanel {...props()} />);
    expect(await screen.findByText('Anulowano')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('offers cancellation retry when the server cannot confirm stopping and hides a racing result', async () => {
    const generation = deferred<Response>();
    let fail = true;
    interceptHttp(call => {
      if (call.path === '/scenes/20/generate') return generation.promise;
      if (call.path === '/scenes/20/cancel-generation') return fail ? jsonResponse({ detail: 'Offline' }, 503) : jsonResponse({ detail: 'Generowanie anulowane. Nie zapisano wariantu.' });
      return jsonResponse({ items: [], count: 0 });
    });
    render(<AssistantPanel {...props()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Test');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj generowanie' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się potwierdzić anulowania');
    expect(screen.queryByText('Generowanie anulowane. Nie zapisano wariantu.')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Anuluj generowanie' }));
    expect(await screen.findByText('Generowanie anulowane. Nie zapisano wariantu.')).toBeInTheDocument();
  });

  it('cancels the backend generation, aborts fetch and ignores a late response', async () => {
    const generation = deferred<Response>();
    const cancellation = deferred<Response>();
    const http = interceptHttp(call => {
      if (call.path === '/scenes/20/generate') return generation.promise;
      if (call.path === '/scenes/20/cancel-generation') return cancellation.promise;
      return call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined;
    });
    render(<AssistantPanel {...props()} />);
    const user = userEvent.setup();
    const cancel = screen.getByRole('button', { name: 'Anuluj generowanie' });
    expect(cancel).toBeDisabled();
    expect(cancel).toHaveClass('full-width', 'cancel-generation');
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Nowy kierunek');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await waitFor(() => expect(http.calls.some(call => call.path === '/scenes/20/generate')).toBe(true));
    await user.click(cancel);
    expect(screen.getByRole('button', { name: 'Anulowanie...' })).toBeDisabled();
    const request = http.calls.find(call => call.path === '/scenes/20/generate')!;
    const abort = http.calls.find(call => call.path === '/scenes/20/cancel-generation')!;
    expect(request.body).toEqual({ ...(abort.body as object), variant_count: 1 });
    expect(abort.headers.get('X-CSRFToken')).toBe('test-csrf');
    await act(async () => { cancellation.resolve(jsonResponse({ detail: 'Generowanie anulowane. Nie zapisano wariantu.' })); });
    expect(await screen.findByText('Generowanie anulowane. Nie zapisano wariantu.')).toBeInTheDocument();
    expect(request.init.signal?.aborted).toBe(true);
    await act(async () => { generation.resolve(jsonResponse([variantFixture()], 201)); });
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Nowy kierunek');
  });

  it('can cancel while waiting for the editor save without sending an LLM request', async () => {
    const preparation = deferred<void>();
    const component = props(); component.onPrepare = vi.fn(() => preparation.promise);
    const http = interceptHttp(call => call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Nowy kierunek');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj generowanie' }));
    await act(async () => { preparation.resolve(); });
    expect(http.calls.every(call => call.method === 'GET')).toBe(true);
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
  });

  it('does not show a racing final result while cancellation is awaiting confirmation', async () => {
    const generation = deferred<Response>();
    const cancellation = deferred<Response>();
    interceptHttp(call => call.path === '/scenes/20/generate' ? generation.promise :
      call.path === '/scenes/20/cancel-generation' ? cancellation.promise : jsonResponse({ items: [], count: 0 }));
    render(<AssistantPanel {...props()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Test');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj generowanie' }));
    await act(async () => { generation.resolve(jsonResponse([variantFixture()], 201)); });
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
    await act(async () => { cancellation.resolve(jsonResponse({ detail: 'Generowanie anulowane. Nie zapisano wariantu.' })); });
    expect(await screen.findByText('Generowanie anulowane. Nie zapisano wariantu.')).toBeInTheDocument();
  });

  it('keeps all variants from the latest batch after generation, refresh and remount', async () => {
    const older = { ...variantFixture(20, 69), run_id: 59, title: 'Poprzedni wariant', is_selected: true };
    const newest = { ...variantFixture(), title: 'Najnowszy wariant' };
    const second = { ...variantFixture(20, 71), variant_number: 2, title: 'Drugi wariant' };
    let generated = false;
    const http = interceptHttp(call => {
      if (call.path === '/scenes/20/generate') { generated = true; return jsonResponse([newest, second], 201); }
      if (call.path === '/scenes/20/variants') {
        const all = generated ? [second, newest, older] : [older];
        const limit = Number(call.url.searchParams.get('limit') ?? 20);
        const offset = Number(call.url.searchParams.get('offset') ?? 0);
        return jsonResponse({ items: all.slice(offset, offset + limit), count: all.length });
      }
      return call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined;
    });
    const component = props();
    const mounted = render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    expect(await screen.findByText('Poprzedni wariant')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Zmień scenę');
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    expect(await screen.findByText('Najnowszy wariant')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odśwież warianty i przebieg' })).toBeEnabled());
    expect(screen.queryByText('Poprzedni wariant')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const reads = http.calls.filter(call => call.path === '/scenes/20/variants').length;
    await user.click(screen.getByRole('button', { name: 'Odśwież warianty i przebieg' }));
    await waitFor(() => expect(http.calls.filter(call => call.path === '/scenes/20/variants').length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odśwież warianty i przebieg' })).toBeEnabled());
    expect(screen.queryByText('Poprzedni wariant')).not.toBeInTheDocument();
    mounted.unmount();
    render(<AssistantPanel {...component} />);
    expect(await screen.findByText('Najnowszy wariant')).toBeInTheDocument();
    expect(screen.queryByText('Poprzedni wariant')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(http.calls.filter(call => call.path === '/scenes/20/variants').every(call => call.url.searchParams.get('limit') === '3')).toBe(true);
    expect(http.calls.filter(call => call.method !== 'GET').map(call => call.path)).toEqual(['/scenes/20/generate']);
    expect(http.calls.find(call => call.method === 'POST')?.body).toMatchObject({ variant_count: 2 });
  });

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
    const readsBeforeRefresh = http.calls.filter(call => call.path.endsWith('/variants')).length;
    const refresh = screen.getByRole('button', { name: 'Odśwież warianty i przebieg' });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('title', 'Pobierz ponownie ostatnią serię wariantów i status.');
    await user.click(refresh);
    expect(http.calls.filter(call => call.path.endsWith('/variants'))).toHaveLength(readsBeforeRefresh);
    expect(http.calls.find(call => call.path === '/scenes/20/generate')?.init.signal?.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Generowanie...' }));
    expect(http.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
    generated = true;
    await act(async () => { generation.resolve(jsonResponse([variantFixture()], 201)); });
    expect(await screen.findByRole('radio', { name: 'Wariant Bielika' })).toBeChecked();
    expect(http.calls.filter(call => call.method !== 'GET').map(call => [call.path, call.body])).toEqual([
      ['/scenes/20/generate', { user_prompt: 'Więcej napięcia', generation_id: expect.any(String), variant_count: 1 }],
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
    expect(http.calls.find(call => call.method === 'POST')?.init.signal?.aborted).toBe(false);
    expect(screen.getByText(/Trwa generowanie w innej scenie/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Dopisz dialog');
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeDisabled();
    await act(async () => { generation.resolve(jsonResponse([variantFixture()], 201)); });
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Dopisz dialog');
    expect(screen.getByRole('button', { name: 'Generuj scenę' })).toBeEnabled();
    expect(screen.queryByText('Znalazłam list.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Wynik generowania' })).not.toBeInTheDocument();
  });
});
