import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantPanel } from '../../src/components/AssistantPanel';
import { toProject } from '../../src/services/workspaceData';
import { promptFixture, workspaceFixture } from '../support/fixtures';
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

  it('saves a prompt only after scene preparation succeeds and does not fabricate a generation', async () => {
    const preparation = deferred<void>();
    const component = props(); component.onPrepare = vi.fn(() => preparation.promise);
    const http = interceptHttp(call => call.path === '/scenes/20/prompts' && call.method === 'POST' ? jsonResponse(promptFixture(), 201) :
      call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), ' Więcej napięcia ');
    await user.click(screen.getByRole('button', { name: 'Zapisz prompt' }));
    expect(component.onPrepare).toHaveBeenCalledTimes(1);
    expect(http.calls.some(call => call.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Kierunek sceny')).toBeDisabled();
    await act(async () => { preparation.resolve(); });
    expect(await screen.findByText('Prompt zapisany. Silnik generowania nie jest jeszcze podłączony.')).toBeInTheDocument();
    expect(http.calls.filter(call => call.method !== 'GET').map(call => [call.path, call.body])).toEqual([
      ['/scenes/20/prompts', { user_prompt: 'Więcej napięcia' }],
    ]);
    expect(screen.getByText('Brak wariantów dla tej sceny.')).toBeInTheDocument();
  });

  it('blocks prompt submission if the pending scene save fails and retains the prompt draft', async () => {
    const component = props(); component.onPrepare.mockRejectedValueOnce(new Error('Zapis sceny nie powiódł się.'));
    const http = interceptHttp(call => call.method === 'GET' ? jsonResponse({ items: [], count: 0 }) : undefined);
    render(<AssistantPanel {...component} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kierunek sceny'), 'Nowy kierunek');
    await user.click(screen.getByRole('button', { name: 'Zapisz prompt' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Zapis sceny nie powiódł się.'));
    expect(http.calls.some(call => call.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Kierunek sceny')).toHaveValue('Nowy kierunek');
  });
});
