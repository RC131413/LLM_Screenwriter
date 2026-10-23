import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import type { AuthView } from '../types';
import { PasswordField } from './PasswordField';
import { ApiError } from '../services/api';
import type { LoginInput, RegisterInput } from '../services/api';
import { errorMessage } from '../services/workspaceData';

export function AuthPage({ mode, onSubmit }: { mode: AuthView; onSubmit: (data: LoginInput | RegisterInput) => Promise<void> }) {
  const registering = mode === 'register';
  const [identity, setIdentity] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [repeatError, setRepeatError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return <div className="auth-page">
    <header className="auth-header"><a href="#login" className="brand"><strong>AgentDraft</strong></a></header>
    <main className="auth-main">
      <section className="auth-content" aria-labelledby="auth-heading">
        <div className="auth-heading"><span className="eyebrow">{registering ? 'NOWE KONTO' : 'TWOJA PRZESTRZEŃ ROBOCZA'}</span><h1 id="auth-heading">{registering ? 'Zarejestruj się' : 'Zaloguj się'}</h1></div>
        <form className="auth-form" onSubmit={async event => {
          event.preventDefault();
          if (pending) return;
          setIdentityError(''); setPasswordError(''); setRepeatError('');
          if (!identity.trim() || (registering && identity.trim().length < 3)) {
            setIdentityError(registering ? 'Nazwa użytkownika musi mieć co najmniej 3 znaki.' : 'Podaj e-mail lub nazwę użytkownika.');
            document.getElementById('auth-identity')?.focus(); return;
          }
          if (!password.trim()) {
            setPasswordError('Hasło nie może składać się wyłącznie ze spacji.');
            document.getElementById('auth-password')?.focus(); return;
          }
          if (registering && password !== repeat) {
            setRepeatError('Hasła nie są takie same.');
            document.getElementById('auth-password-repeat')?.focus(); return;
          }
          setPending(true); setError('');
          try {
            await onSubmit(registering ? { username: identity.trim(), email: email.trim(), password, password_confirm: repeat } : { identifier: identity.trim(), password });
            setPassword(''); setRepeat('');
          } catch (failure) {
            setError(failure instanceof ApiError && failure.status === 401 ? 'Nieprawidłowy e-mail, nazwa użytkownika lub hasło.' :
              registering && failure instanceof ApiError && failure.status === 409 ? 'Ta nazwa użytkownika lub adres e-mail jest już używany.' : errorMessage(failure));
          }
          finally { setPending(false); }
        }}>
          <div><label className="field-label" htmlFor="auth-identity">{registering ? 'Nazwa użytkownika' : 'E-mail lub nazwa użytkownika'}</label><input id="auth-identity" name="username" className="field-input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={registering ? 3 : undefined} maxLength={registering ? 80 : 254} value={identity} aria-invalid={identityError ? true : undefined} aria-describedby={identityError ? 'auth-identity-error' : undefined} onChange={event => { setIdentity(event.target.value); setIdentityError(''); }} />{identityError && <p className="form-error" role="alert" id="auth-identity-error">{identityError}</p>}</div>
          {registering && <div><label className="field-label" htmlFor="auth-email">E-mail</label><input id="auth-email" name="email" className="field-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></div>}
          <PasswordField label="Hasło" name="auth-password" value={password} onChange={value => { setPassword(value); setPasswordError(''); setRepeatError(''); }} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 8 : undefined} error={passwordError} />
          {registering && <PasswordField label="Powtórz hasło" name="auth-password-repeat" value={repeat} onChange={value => { setRepeat(value); setRepeatError(''); }} autoComplete="new-password" error={repeatError} />}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={pending} className="button primary auth-submit">{registering ? <UserPlus size={17} /> : <LogIn size={17} />}{pending ? 'Łączenie…' : registering ? 'Zarejestruj się' : 'Zaloguj się'}</button>
        </form>
        <p className="auth-switch">{registering ? 'Masz już konto?' : 'Nie masz konta?'} <a href={registering ? '#login' : '#register'}>{registering ? 'Zaloguj się' : 'Zarejestruj się'}</a></p>
      </section>
    </main>
  </div>;
}
