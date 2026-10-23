import { useState } from 'react';
import { Check, KeyRound, LogOut } from 'lucide-react';
import type { UserProfile } from '../types';
import type { ChangePasswordInput } from '../services/api';
import { errorMessage } from '../services/workspaceData';
import { UserAvatar } from './UserMenu';
import { PasswordField } from './PasswordField';

interface Props {
  profile: UserProfile;
  onSave: (profile: Pick<UserProfile, 'username' | 'display_name' | 'avatar_url'>) => Promise<void>;
  onLogout: () => void;
  onPasswordChange: (data: ChangePasswordInput) => Promise<unknown>;
}

export function AccountSettings({ profile, onSave, onLogout, onPasswordChange }: Props) {
  const [username, setUsername] = useState(profile.username);
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar_url ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', repeat: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordPending, setPasswordPending] = useState(false);
  const dirty = username !== profile.username || name !== profile.display_name || avatar !== (profile.avatar_url ?? '');
  const changePassword = (key: keyof typeof passwords, value: string) => { setPasswords(current => ({ ...current, [key]: value })); setPasswordError(''); setPasswordMessage(''); };
  return <div className="account-settings">
    <section className="settings-section"><div className="settings-section-heading"><h2>Profil</h2></div>
      <form onSubmit={async event => {
        event.preventDefault(); if (pending) return;
        setPending(true); setError(''); setMessage('');
        try { await onSave({ username: username.trim(), display_name: name.trim(), avatar_url: avatar.trim() || null }); setMessage('Zmiany zapisane.'); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setPending(false); }
      }}>
        <div className="account-avatar-row"><UserAvatar profile={{ display_name: name, avatar_url: profile.avatar_url }} /></div>
        <div className="account-fields">
          <div><label className="field-label" htmlFor="account-username">Nazwa użytkownika</label><input id="account-username" className="field-input" autoComplete="username" required maxLength={150} value={username} onChange={event => { setUsername(event.target.value); setMessage(''); }} /></div>
          <div><label className="field-label" htmlFor="display-name">Nazwa wyświetlana</label><input id="display-name" className="field-input" autoComplete="nickname" maxLength={150} value={name} onChange={event => { setName(event.target.value); setMessage(''); }} /></div>
          <div><label className="field-label" htmlFor="account-email">Adres e-mail</label><input id="account-email" className="field-input" type="email" autoComplete="email" value={profile.email} readOnly /></div>
          <div><label className="field-label" htmlFor="avatar-url">Adres zdjęcia (URL)</label><input id="avatar-url" className="field-input" type="url" maxLength={2048} value={avatar} onChange={event => { setAvatar(event.target.value); setMessage(''); }} /></div>
          <div><label className="field-label" htmlFor="preferred-language">Język</label><div className="language-select"><span className="polish-flag" role="img" aria-label="Flaga Polski" /><select id="preferred-language" className="field-input" value={profile.preferred_language} disabled><option value="pl">Polski</option></select></div></div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="settings-form-actions"><span className="settings-success" role="status">{message && <><Check size={15} />{message}</>}</span><button type="button" className="button" disabled={!dirty || pending} onClick={() => { setUsername(profile.username); setName(profile.display_name); setAvatar(profile.avatar_url ?? ''); setError(''); }}>Anuluj</button><button type="submit" className="button primary" disabled={!dirty || pending}>{pending ? 'Zapisywanie…' : 'Zapisz zmiany'}</button></div>
      </form></section>
    <section className="settings-section"><div className="settings-section-heading"><h2>Bezpieczeństwo</h2></div>
      <div className="password-section-heading"><div><KeyRound size={17} /><span>Hasło</span></div><button type="button" className="button" disabled={passwordPending} aria-expanded={passwordOpen} onClick={() => { setPasswordOpen(value => !value); setPasswords({ current: '', next: '', repeat: '' }); setPasswordError(''); setPasswordMessage(''); }}>{passwordOpen ? 'Anuluj zmianę hasła' : 'Zmień hasło'}</button></div>
      {passwordOpen && <form className="password-form" onSubmit={async event => {
        event.preventDefault(); if (passwordPending) return;
        setPasswordError(''); setPasswordMessage('');
        if (passwords.next !== passwords.repeat) { setPasswordError('Nowe hasła nie są takie same.'); return; }
        setPasswordPending(true);
        try {
          await onPasswordChange({ old_password: passwords.current, new_password: passwords.next, new_password_confirm: passwords.repeat });
          setPasswords({ current: '', next: '', repeat: '' }); setPasswordMessage('Hasło zostało zmienione.');
        } catch (failure) { setPasswordError(errorMessage(failure)); }
        finally { setPasswordPending(false); }
      }}>
        <PasswordField label="Obecne hasło" name="current-password" value={passwords.current} onChange={value => changePassword('current', value)} autoComplete="current-password" />
        <PasswordField label="Nowe hasło" name="new-password" value={passwords.next} onChange={value => changePassword('next', value)} autoComplete="new-password" minLength={8} />
        <PasswordField label="Powtórz nowe hasło" name="repeat-password" value={passwords.repeat} onChange={value => changePassword('repeat', value)} autoComplete="new-password" />
        {passwordError && <p className="form-error" role="alert">{passwordError}</p>}{passwordMessage && <p role="status">{passwordMessage}</p>}
        <div className="settings-form-actions"><button type="submit" className="button" disabled={passwordPending}>{passwordPending ? 'Zapisywanie…' : 'Zmień hasło'}</button></div>
      </form>}
    </section>
    <section className="settings-section account-session"><h2>Sesja</h2><button type="button" className="button danger" onClick={onLogout}><LogOut size={15} />Wyloguj</button></section>
  </div>;
}
