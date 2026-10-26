import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthPage } from '../../src/components/AuthPage';
import { api } from '../../src/services/api';
import type { RegisterInput } from '../../src/services/api';
import { deferred, interceptHttp, jsonResponse } from '../support/http';
import { userFixture } from '../support/fixtures';

describe('authentication forms connected to the API', () => {
  it('submits email or username, disables duplicate submissions and clears the password after confirmation', async () => {
    const response = deferred<Response>();
    const http = interceptHttp(call => call.path === '/auth/login' ? response.promise : undefined);
    render(<AuthPage mode="login" onSubmit={async data => { if ('identifier' in data) await api.auth.login(data); }} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail lub nazwa użytkownika'), ' writer1@example.com ');
    await user.type(screen.getByLabelText('Hasło', { exact: true }), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(screen.getByRole('button', { name: 'Łączenie…' })).toBeDisabled();
    expect(http.calls.filter(call => call.path === '/auth/login')).toHaveLength(1);
    expect(http.calls[0].body).toEqual({ identifier: 'writer1@example.com', password: 'test-password' });
    await act(async () => { response.resolve(jsonResponse(userFixture())); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zaloguj się' })).toBeEnabled());
    expect(screen.getByLabelText('Hasło', { exact: true })).toHaveValue('');
  });

  it('shows a credential error and retains the entered identity for correction', async () => {
    interceptHttp(() => jsonResponse({ detail: 'Unauthorized' }, 401));
    render(<AuthPage mode="login" onSubmit={async data => { if ('identifier' in data) await api.auth.login(data); }} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail lub nazwa użytkownika'), 'writer1');
    await user.type(screen.getByLabelText('Hasło', { exact: true }), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy e-mail, nazwa użytkownika lub hasło.');
    expect(screen.getByLabelText('E-mail lub nazwa użytkownika')).toHaveValue('writer1');
    expect(screen.getByRole('link', { name: 'Zarejestruj się' })).toHaveAttribute('href', '#register');
  });

  it('checks password confirmation before registration and explains a conflicting email', async () => {
    const http = interceptHttp(() => jsonResponse({ detail: 'Conflict' }, 409));
    render(<AuthPage mode="register" onSubmit={async data => { await api.auth.register(data as RegisterInput); }} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nazwa użytkownika'), 'writer1');
    await user.type(screen.getByLabelText('E-mail', { exact: true }), 'writer1@example.com');
    await user.type(screen.getByLabelText('Hasło', { exact: true }), 'test-password');
    await user.type(screen.getByLabelText('Powtórz hasło'), 'mismatch');
    await user.click(screen.getByRole('button', { name: 'Zarejestruj się' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Hasła nie są takie same.');
    expect(http.calls).toHaveLength(0);
    await user.clear(screen.getByLabelText('Powtórz hasło'));
    await user.type(screen.getByLabelText('Powtórz hasło'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Zarejestruj się' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ta nazwa użytkownika lub adres e-mail jest już używany.');
    expect(http.calls[0].body).toEqual({ username: 'writer1', email: 'writer1@example.com', password: 'test-password', password_confirm: 'test-password' });
  });
});
