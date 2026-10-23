import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import type { UserProfile } from '../types';

export function UserAvatar({ profile }: { profile: Pick<UserProfile, 'display_name' | 'avatar_url'> }) {
  return <span className="user-avatar" aria-hidden="true">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <UserRound size={19} strokeWidth={1.5} />}</span>;
}

export function UserMenu({ profile, onSettings, onLogout }: { profile: UserProfile; onSettings: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const focusOutside = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  return <div className="user-menu" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="user-menu-trigger" title={`Konto: ${profile.display_name}`} aria-label={`Menu użytkownika: ${profile.display_name}`} aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
    }}><UserAvatar profile={profile} /><span className="user-menu-name">{profile.display_name}</span><ChevronDown size={13} /></button>
    {open && <div className="user-menu-popover" role="menu" id={menuId} aria-label="Konto użytkownika" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <div className="user-menu-identity"><strong>{profile.display_name}</strong><span>{profile.email}</span></div>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}><Settings size={16} />Ustawienia</button>
      <button type="button" role="menuitem" className="logout-action" onClick={() => { setOpen(false); onLogout(); }}><LogOut size={16} />Wyloguj</button>
    </div>}
  </div>;
}
