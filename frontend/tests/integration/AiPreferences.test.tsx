import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import type { ApiPreferences } from '../../src/services/api';
import { preferencesFixture, userFixture } from '../support/fixtures';
import { jsonResponse } from '../support/http';
import { workspaceHttp } from '../support/workspaceHttp';

describe('shared AI preferences entry points', () => {
  it('uses the same saved account preferences in dashboard, scene sidebar and account settings', async () => {
    let preferences = preferencesFixture();
    const http = workspaceHttp((call, workspace) => {
      if (call.path === '/users/me') return jsonResponse(userFixture());
      if (call.path === '/users/me/preferences') {
        if (call.method === 'PUT') preferences = call.body as ApiPreferences;
        return jsonResponse(preferences);
      }
      if (call.path === '/projects/1/actions/open') return jsonResponse(workspace.project);
      if (['/scenes/20/prompts', '/scenes/20/runs', '/scenes/20/variants'].includes(call.path)) return jsonResponse({ items: [], count: 0 });
      return undefined;
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ustawienia i AI' }));
    await user.selectOptions(screen.getByLabelText('Domyślny ton dialogów'), 'Ciepły, empatyczny');
    await user.selectOptions(screen.getByLabelText('Styl opisów akcji'), 'literary_descriptive');
    await user.selectOptions(screen.getByLabelText('Wskazówki aktorskie w nawiasach'), 'standard');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    await screen.findByRole('link', { name: 'Otwórz projekt Nocny pociąg' });
    await user.click(screen.getByRole('link', { name: 'Otwórz projekt Nocny pociąg' }));
    const sidebar = await screen.findByRole('complementary', { name: 'Lista scen' });
    expect(within(sidebar).getByText('LOGLINE')).toBeInTheDocument();
    await user.click(within(sidebar).getByRole('button', { name: 'Ustawienia i AI' }));
    expect(screen.getByRole('dialog', { name: 'Ustawienia i AI' })).toBeInTheDocument();
    expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('Ciepły, empatyczny');
    expect(screen.getByLabelText('Styl opisów akcji')).toHaveValue('literary_descriptive');
    expect(screen.getByLabelText('Wskazówki aktorskie w nawiasach')).toHaveValue('standard');
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    await user.click(screen.getByRole('button', { name: /Menu użytkownika/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Ustawienia' }));
    await user.click(await screen.findByRole('tab', { name: 'Preferencje AI' }));
    expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('Ciepły, empatyczny');
    expect(screen.getByLabelText('Wskazówki aktorskie w nawiasach')).toHaveValue('standard');
    expect(http.calls.filter(call => call.path === '/users/me/preferences' && call.method === 'PUT')).toHaveLength(1);
  });
});
