import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import { preferencesFixture, userFixture } from '../support/fixtures';
import { jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

describe('editor view preferences', () => {
  it('changes the view and restores it after reload without modifying scene or AI data', async () => {
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') return jsonResponse(preferencesFixture());
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
      return undefined;
    });
    http.workspace.scenes[0].editor_metadata.blocks = [
      { id: 'a', type: 'action', text: 'Anna czyta list.' },
      { id: 'b', type: 'character', text: 'ANNA' },
      { id: 'c', type: 'dialogue', text: 'Znam to pismo.' },
    ];
    http.workspace.scenes[0].content_text = 'Anna czyta list.\n\nANNA\n\nZnam to pismo.';
    const original = structuredClone(http.workspace.scenes[0]);
    const mounted = render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    await screen.findByLabelText('Akcja 1');
    await user.click(screen.getByRole('button', { name: 'Ustawienia' }));
    const dialog = screen.getByRole('dialog', { name: 'Ustawienia edytora' });
    expect(within(dialog).getByText('Courier New · 12 pt')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('PostgreSQL'); expect(dialog).not.toHaveTextContent('Bielik');
    await user.click(within(dialog).getByRole('button', { name: 'Zwiększ powiększenie' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Sprawdzanie pisowni' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Etykiety typów elementów' }));
    expect(within(dialog).getByLabelText('Powiększenie widoku')).toHaveTextContent('110%');
    await user.click(within(dialog).getByRole('button', { name: 'Gotowe' }));
    const assertView = () => {
      const action = screen.getByLabelText('Akcja 1');
      expect(action).toHaveAttribute('spellcheck', 'true');
      expect(screen.getByLabelText('Dialog 3')).toHaveAttribute('spellcheck', 'true');
      expect(screen.getByLabelText('Postać 2')).toHaveAttribute('spellcheck', 'false');
      expect(action.closest('.document-scroll')).toHaveAttribute('lang', 'pl');
      expect(action.closest('.document-sheet')).toHaveStyle({ zoom: '1.1' });
      expect([...document.querySelectorAll('.script-block-type')].map(node => node.textContent)).toEqual(['Akcja', 'Postać', 'Dialog']);
    };
    assertView();
    mounted.unmount(); render(<App />);
    await screen.findByLabelText('Akcja 1'); assertView();
    expect(http.workspace.scenes[0]).toEqual(original);
    expect(http.calls.filter(call => ['PATCH', 'PUT', 'DELETE'].includes(call.method))).toEqual([]);
  });
});
