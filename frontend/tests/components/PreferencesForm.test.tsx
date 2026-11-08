import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    await user.selectOptions(screen.getByLabelText('Styl opisów akcji'), 'literary_descriptive');
    await user.selectOptions(screen.getByLabelText('Domyślny ton dialogów'), 'Oszczędny, z podtekstem');
    await user.selectOptions(screen.getByLabelText('Wskazówki aktorskie w nawiasach'), 'ignore');
    await user.click(screen.getByRole('tab', { name: 'Preferencje silnika' }));
    expect(screen.getByLabelText('Główny model AI')).toBeDisabled();
    const tokens = screen.getByLabelText('Limit odpowiedzi modelu (tokeny)');
    expect(tokens).toBeDisabled(); expect(tokens).toHaveValue(2048);
    await user.type(tokens, '1'); expect(tokens).toHaveValue(2048);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.4' } });
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(http.calls[0]).toMatchObject({ method: 'PUT', path: '/users/me/preferences', body: {
      writing_style_preferences: { stage_directions_style: 'literary_descriptive', dialogue_tone: 'Oszczędny, z podtekstem', parentheticals: 'ignore' },
      llm_preferences: { model_name: 'Bielik 11B (Lokalny)', temperature: 0.4, max_tokens: 2048 },
    } });
    expect(screen.getByText('Preferencje zapisane.')).toHaveAttribute('role', 'status');
  });

  it('does not announce success on failure and resets from server defaults', async () => {
    let fail = true;
    const http = interceptHttp(() => fail ? jsonResponse({ detail: 'Settings unavailable' }, 503) : jsonResponse(preferencesFixture()));
    render(<PreferencesForm preferences={preferencesFixture()} onCancel={vi.fn()} onSave={api.account.savePreferences}
      onReset={() => api.account.savePreferences({})} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Domyślny ton dialogów'), 'custom');
    await user.clear(screen.getByLabelText('Własny ton dialogów'));
    await user.type(screen.getByLabelText('Własny ton dialogów'), 'Nowy ton');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Własny ton dialogów')).toHaveValue('Nowy ton');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Resetuj' }));
    await waitFor(() => expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('Neutralny, realistyczny'));
    expect(screen.queryByLabelText('Własny ton dialogów')).not.toBeInTheDocument();
    expect(http.calls.at(-1)?.body).toEqual({});
    expect(screen.getByRole('status')).toHaveTextContent('Przywrócono domyślne preferencje.');
  });

  it('preserves an existing custom dialogue tone and trims edits before saving', async () => {
    const preferences = preferencesFixture();
    preferences.writing_style_preferences.dialogue_tone = 'Suchy humor i niedopowiedzenia';
    const save = vi.fn(async value => value);
    render(<PreferencesForm preferences={preferences} onCancel={vi.fn()} onSave={save} onReset={vi.fn()} />);
    expect(screen.getByLabelText('Domyślny ton dialogów')).toHaveValue('custom');
    expect(screen.getByLabelText('Własny ton dialogów')).toHaveValue('Suchy humor i niedopowiedzenia');
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Własny ton dialogów'));
    await user.type(screen.getByLabelText('Własny ton dialogów'), '  Zdystansowany, uprzejmy  ');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ writing_style_preferences: expect.objectContaining({ dialogue_tone: 'Zdystansowany, uprzejmy' }) }));
  });

  it('saves standard acting directions and shows field help without submitting or changing values', async () => {
    const preferences = preferencesFixture();
    const save = vi.fn(async value => value);
    render(<PreferencesForm preferences={preferences} onSave={save} onCancel={vi.fn()} onReset={vi.fn()} />);
    const user = userEvent.setup();
    const field = screen.getByLabelText('Wskazówki aktorskie w nawiasach');
    expect(field).toHaveValue('sparingly');
    expect(within(field).getAllByRole('option').map(option => option.textContent)).toEqual(['Wyłączone', 'Oszczędnie', 'Standardowo']);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const info = screen.getByRole('button', { name: 'Informacja: Wskazówki aktorskie w nawiasach' });
    await user.hover(info);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Standardowo: naturalne wskazówki');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.click(info);
    expect(screen.getByRole('tooltip')).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    await user.selectOptions(field, 'standard');
    await user.click(screen.getByRole('button', { name: 'Zapisz preferencje' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ writing_style_preferences: expect.objectContaining({ parentheticals: 'standard' }) }));
  });
});
