import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import type { ApiActiveGeneration, GenerateSceneInput } from '../../src/services/api';
import { preferencesFixture, userFixture, variantFixture } from '../support/fixtures';
import { activeFixture, executionFixture as agent, progressFixture, runDetailFixture } from '../support/generation';
import { deferred, jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

describe('live workflow in the editor', () => {
  it('displays changing server stages during the same request and restores the final run and variants', async () => {
    const response = deferred<Response>();
    let active: ApiActiveGeneration | null = null;
    let finished = false;
    const completed = progressFixture({ percent: 100, completed_steps: 4, status: 'completed',
      agent_executions: ['archivist', 'director', 'scenarist', 'critic'].map(node => agent(node, 'completed')) });
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (call.path === '/generation/active') return jsonResponse(active);
      if (call.path === '/scenes/20/generate') {
        const payload = call.body as GenerateSceneInput;
        active = { ...activeFixture(), generation_id: payload.generation_id!, user_prompt: payload.user_prompt };
        return response.promise;
      }
      if (call.path === '/scenes/20/runs') return jsonResponse({ items: finished ? [{ id: 60 }] : [], count: finished ? 1 : 0 });
      if (call.path === '/runs/60') return jsonResponse(runDetailFixture(completed));
      if (call.path === '/scenes/20/variants') return jsonResponse({ items: finished ? [variantFixture()] : [], count: finished ? 1 : 0 });
      if (call.path === '/scenes/20/prompts') return jsonResponse({ items: [], count: 0 });
      return undefined;
    });
    render(<App />); const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    await user.type(await screen.findByLabelText('Kierunek sceny'), 'Anna otwiera list.');
    await user.click(screen.getByRole('button', { name: 'Generuj scenę' }));
    await waitFor(() => expect(active).not.toBeNull());
    fireEvent.focus(window);
    await waitFor(() => expect(document.querySelector('[data-node="archivist"]')).toHaveAttribute('data-status', 'running'));
    await user.click(screen.getByText('Szczegóły agentów'));
    const details = screen.getByText('Szczegóły agentów').closest('details')!;
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(screen.queryByText('ZAPISANE WARIANTY')).not.toBeInTheDocument();
    active = { ...active!, ...activeFixture(progressFixture({ percent: 25, completed_steps: 1,
      agent_executions: [agent('archivist', 'completed'), agent('director')] })), generation_id: active!.generation_id };
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25'));
    expect(details).toHaveAttribute('open');
    expect(document.querySelector('[data-node="director"]')).toHaveAttribute('data-status', 'running');
    expect(document.querySelector('[data-node="archivist"]')).toHaveTextContent('Zakończono');
    finished = true; active = null;
    await act(async () => { response.resolve(jsonResponse([variantFixture()], 201)); });
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100'));
    expect(screen.getByText('Szczegóły agentów').closest('details')).toHaveAttribute('open');
    expect(await screen.findByRole('radio', { name: 'Wariant Bielika' })).toBeChecked();
    expect(http.calls.filter(call => call.path === '/scenes/20/generate')).toHaveLength(1);
  });
});
