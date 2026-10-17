import { useRef, useState } from 'react';
import { Camera, Check, KeyRound, LogOut, Trash2 } from 'lucide-react';
import type { UserProfile } from '../types';
import { UserAvatar } from './UserMenu';
import { PasswordField } from './PasswordField';

interface Props {
  profile: UserProfile;
  onSave: (profile: Pick<UserProfile, 'display_name' | 'avatar_url'>) => boolean;
}

export function AccountSettings({ profile, onSave }: Props) {
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar_url);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', repeat: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const uploadVersion = useRef(0);
  const dirty = name !== profile.display_name || avatar !== profile.avatar_url;
  const changePassword = (key: keyof typeof passwords, value: string) => { setPasswords(current => ({ ...current, [key]: value })); setPasswordError(''); setPasswordMessage(''); };
  return <div className="account-settings">
    <section className="settings-section">
      <div className="settings-section-heading"><h2>Profil</h2><span className="account-badge">Konto demonstracyjne</span></div>
      <form onSubmit={event => {
        event.preventDefault(); setError(''); setMessage('');
        if (!name.trim()) { setError('Podaj nazwę użytkownika.'); return; }
        if (!onSave({ display_name: name, avatar_url: avatar })) { setError('Nie udało się zapisać profilu. Sprawdź dostępne miejsce w przeglądarce.'); return; }
        setName(name.trim()); setMessage('Zmiany zapisane.');
      }}>
        <div className="account-avatar-row"><UserAvatar profile={{ display_name: name, avatar_url: avatar }} /><div className="account-avatar-actions"><button type="button" className="button" disabled={avatarLoading} onClick={() => upload.current?.click()}><Camera size={15} />{avatarLoading ? 'Wczytywanie…' : 'Zmień zdjęcie'}</button>{avatar && <button type="button" className="button" onClick={() => { uploadVersion.current++; setAvatar(null); setAvatarLoading(false); setMessage(''); }}><Trash2 size={14} />Usuń zdjęcie</button>}</div>
          <input ref={upload} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Zdjęcie profilowe" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            const version = ++uploadVersion.current;
            setError(''); setMessage('');
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setAvatarLoading(false); setError('Wybierz zdjęcie PNG, JPG lub WebP o rozmiarze do 2 MB.'); return; }
            setAvatarLoading(true);
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result);
              const image = new Image();
              image.onload = () => { if (version === uploadVersion.current) { setAvatar(url); setAvatarLoading(false); } };
              image.onerror = () => { if (version === uploadVersion.current) { setError('Nie można odczytać tego zdjęcia.'); setAvatarLoading(false); } };
              image.src = url;
            };
            reader.onerror = () => { if (version === uploadVersion.current) { setError('Nie można odczytać pliku.'); setAvatarLoading(false); } };
            reader.readAsDataURL(file);
          }} />
        </div>
        <div className="account-fields">
          <div><label className="field-label" htmlFor="display-name">Nazwa użytkownika</label><input id="display-name" name="display_name" className="field-input" autoComplete="nickname" required maxLength={80} value={name} onChange={event => { setName(event.target.value); setMessage(''); }} /></div>
          <div><label className="field-label" htmlFor="account-email">Adres e-mail</label><input id="account-email" className="field-input" type="email" autoComplete="email" value={profile.email} readOnly aria-readonly="true" /></div>
          <div><label className="field-label" htmlFor="preferred-language">Język</label><div className="language-select"><span className="polish-flag" role="img" aria-label="Flaga Polski" /><select id="preferred-language" name="preferred_language" className="field-input" defaultValue="pl"><option value="pl">Polski</option></select></div></div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="settings-form-actions"><span className="settings-success" role="status">{message && <><Check size={15} />{message}</>}</span><button type="button" className="button" disabled={!dirty || avatarLoading} onClick={() => { uploadVersion.current++; setName(profile.display_name); setAvatar(profile.avatar_url); setError(''); setMessage(''); }}>Anuluj</button><button type="submit" className="button primary" disabled={!dirty || avatarLoading}>Zapisz zmiany</button></div>
      </form>
    </section>
    <section className="settings-section">
      <div className="settings-section-heading"><h2>Bezpieczeństwo</h2></div>
      <div className="password-section-heading"><div><KeyRound size={17} /><span>Hasło</span></div><button type="button" className="button" aria-expanded={passwordOpen} aria-controls="password-form" onClick={() => { setPasswordOpen(value => !value); setPasswords({ current: '', next: '', repeat: '' }); setPasswordError(''); setPasswordMessage(''); }}>{passwordOpen ? 'Anuluj zmianę hasła' : 'Zmień hasło'}</button></div>
      {passwordOpen && <form id="password-form" className="password-form" onSubmit={event => {
        event.preventDefault(); setPasswordMessage('');
        if (passwords.next.length < 8) { setPasswordError('Nowe hasło musi mieć co najmniej 8 znaków.'); return; }
        if (passwords.current === passwords.next) { setPasswordError('Nowe hasło musi różnić się od obecnego.'); return; }
        if (passwords.next !== passwords.repeat) { setPasswordError('Nowe hasła nie są takie same.'); return; }
        setPasswordError(''); setPasswords({ current: '', next: '', repeat: '' });
        setPasswordMessage('Hasło nie zostało zmienione. Zmiana wymaga połączenia z serwerem konta.');
      }}>
        <PasswordField label="Obecne hasło" name="current-password" value={passwords.current} onChange={value => changePassword('current', value)} autoComplete="current-password" />
        <PasswordField label="Nowe hasło" name="new-password" value={passwords.next} onChange={value => changePassword('next', value)} autoComplete="new-password" />
        <PasswordField label="Powtórz nowe hasło" name="repeat-password" value={passwords.repeat} onChange={value => changePassword('repeat', value)} autoComplete="new-password" />
        {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
        {passwordMessage && <p className="password-message" role="status">{passwordMessage}</p>}
        <div className="settings-form-actions"><button type="submit" className="button">Zmień hasło</button></div>
      </form>}
    </section>
    <section className="settings-section account-session"><h2>Sesja</h2><button type="button" className="button danger" onClick={() => { window.location.hash = '#login'; }}><LogOut size={15} />Wyloguj</button></section>
  </div>;
}
