import { useState } from 'react';
import { FileText, LogIn, UserPlus } from 'lucide-react';
import type { AuthView } from '../types';
import { PasswordField } from './PasswordField';

export function AuthPage({ mode, onSubmit }: { mode: AuthView; onSubmit: () => void }) {
  const registering = mode === 'register';
  const [identity, setIdentity] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [repeatError, setRepeatError] = useState('');
  return <div className="auth-page">
    <header className="auth-header"><a href="#login" className="brand"><FileText size={21} strokeWidth={1.6} /><span>LLM <strong>Screenwriter</strong></span></a><span className="auth-demo-badge"><span className="status-dot" />Tryb demonstracyjny</span></header>
    <main className="auth-main">
      <section className="auth-content" aria-labelledby="auth-heading">
        <div className="auth-heading"><span className="eyebrow">{registering ? 'NOWE KONTO' : 'TWOJA PRZESTRZEŃ ROBOCZA'}</span><h1 id="auth-heading">{registering ? 'Zarejestruj się' : 'Zaloguj się'}</h1></div>
        <form className="auth-form" onSubmit={event => {
          event.preventDefault();
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
          setPassword(''); setRepeat(''); onSubmit();
        }}>
          <div><label className="field-label" htmlFor="auth-identity">{registering ? 'Nazwa użytkownika' : 'E-mail lub nazwa użytkownika'}</label><input id="auth-identity" name="username" className="field-input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={registering ? 3 : undefined} maxLength={registering ? 80 : 254} value={identity} aria-invalid={identityError ? true : undefined} aria-describedby={identityError ? 'auth-identity-error' : undefined} onChange={event => { setIdentity(event.target.value); setIdentityError(''); }} />{identityError && <p className="form-error" role="alert" id="auth-identity-error">{identityError}</p>}</div>
          {registering && <div><label className="field-label" htmlFor="auth-email">E-mail</label><input id="auth-email" name="email" className="field-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></div>}
          <PasswordField label="Hasło" name="auth-password" value={password} onChange={value => { setPassword(value); setPasswordError(''); setRepeatError(''); }} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 8 : undefined} error={passwordError} />
          {registering && <PasswordField label="Powtórz hasło" name="auth-password-repeat" value={repeat} onChange={value => { setRepeat(value); setRepeatError(''); }} autoComplete="new-password" error={repeatError} />}
          <button type="submit" className="button primary auth-submit">{registering ? <UserPlus size={17} /> : <LogIn size={17} />}{registering ? 'Zarejestruj się' : 'Zaloguj się'}</button>
        </form>
        <p className="auth-switch">{registering ? 'Masz już konto?' : 'Nie masz konta?'} <a href={registering ? '#login' : '#register'}>{registering ? 'Zaloguj się' : 'Zarejestruj się'}</a></p>
      </section>
    </main>
  </div>;
}
