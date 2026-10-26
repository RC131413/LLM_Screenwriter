import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesForm } from '../../src/components/PreferencesForm';
import { api } from '../../src/services/api';
import { preferencesFixture } from '../support/fixtures';
import { interceptHttp, jsonResponse } from '../support/http';

describe('AI preferences form', () => {
  it('saves both tabs through PUT and keeps the engine model readonly', async () => {
    const saved = vi.fn();
    const http = interceptHttp(call => jsonResponse(call.body));
    render(<PreferencesForm preferences={preferencesFixture()} onCancel={vi.fn()} onSave={api.account.savePreferences}
      onReset={() => api.account.savePreferences({})} onSaved={saved} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Domyślny ton dialogów'));
    await user.type(screen.getByLabelText('Domyślny ton dialogów'), 'Oszczędny');
    await user.click(screen.getByRole('tab', { name: 'Preferencje silnika' }));
    expect(screen.getByLabelText('Główny model AI')).toBeDisabled();
    await user.clear(screen.getByLabelText('Max długość odpowiedzi (Tokeny)'));
    await user.type(screen.getByLabelText('Max długość odpowiedzi (Tokeny)'), '1024');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(http.calls[0]).toMatchObject({ method: 'PUT', path: '/users/me/preferences', body: {
      writing_style_preferences: { dialogue_tone: 'Oszczędny' }, llm_preferences: { model_name: 'Bielik 11B (Lokalny)', max_tokens: 1024 },
    } });
    expect(screen.getByText('Preferencje zapisane.')).toHaveAttribute('role', 'status');
  });

  it('does not announce success on failure and resets from server defaults', async () => {
    let fail = true;
    const http = interceptHttp(() => fail ? jsonResponse({ detail: 'Settings unavailable' }, 503) : jsonResponse(preferencesFixture()));
    render(<PreferencesForm preferences={preferencesFixture()} onCancel={vi.fn()} onSave={api.account.savePreferences}
      onReset={() => api.account.savePreferences({})} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Domyślny ton dialogów'));
    await user.type(screen.getByLabelText('Domyślny ton dialogów'), 'Nowy ton');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('Nowy ton');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Resetuj' }));
    await waitFor(() => expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('Neutralny, realistyczny'));
    expect(http.calls.at(-1)?.body).toEqual({});
    expect(screen.getByRole('status')).toHaveTextContent('Przywrócono domyślne preferencje.');
  });
});
