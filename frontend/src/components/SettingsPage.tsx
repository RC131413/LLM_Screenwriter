import { useState } from 'react';
import { ArrowLeft, ChartNoAxesColumn, SlidersHorizontal, UserRound } from 'lucide-react';
import type { Project, SettingsTab, UserPreferences, UserProfile } from '../types';
import { UserMenu } from './UserMenu';
import { AccountSettings } from './AccountSettings';
import { PreferencesForm } from './PreferencesForm';
import { StatisticsView } from './StatisticsView';

interface Props {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  returnHref: string;
  profile: UserProfile;
  onProfileSave: (profile: Pick<UserProfile, 'display_name' | 'avatar_url'>) => boolean;
  preferences: UserPreferences;
  onPreferencesSave: (preferences: UserPreferences) => boolean;
  projects: Project[];
}

export function SettingsPage({ tab, onTab, returnHref, profile, onProfileSave, preferences, onPreferencesSave, projects }: Props) {
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const tabs = [
    { id: 'account', label: 'Moje konto', icon: UserRound },
    { id: 'ai', label: 'Preferencje AI', icon: SlidersHorizontal },
    { id: 'statistics', label: 'Statystyki', icon: ChartNoAxesColumn },
  ] as const;
  return <>
    <header className="topbar settings-topbar">
      <div className="brand"><strong>AgentDraft</strong></div>
      <span className="dashboard-location">Ustawienia</span>
      <div className="topbar-actions"><a className="editor-back-link" href={returnHref}><ArrowLeft size={15} /><span>{returnHref.startsWith('#project/') ? 'Wróć do edytora' : 'Wróć do projektów'}</span></a></div>
      <UserMenu profile={profile} onSettings={() => onTab('account')} />
    </header>
    <main className="settings-main">
      <div className="settings-content">
        <div className="settings-page-heading"><span className="eyebrow">PRZESTRZEŃ OSOBISTA</span><h1>Ustawienia</h1></div>
        <div className="settings-page-tabs" role="tablist" aria-label="Ustawienia konta">{tabs.map((item, index) => <button type="button" role="tab" id={`settings-tab-${item.id}`} key={item.id} aria-selected={tab === item.id} aria-controls="settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          onTab(tabs[next].id); document.getElementById(`settings-tab-${tabs[next].id}`)?.focus();
        }}><item.icon size={16} /><span>{item.label}</span></button>)}</div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'account' ? <AccountSettings profile={profile} onSave={onProfileSave} /> : tab === 'ai' ? <section className="settings-preferences"><PreferencesForm key={preferencesVersion} preferences={preferences} onSave={onPreferencesSave} onCancel={() => setPreferencesVersion(value => value + 1)} /></section> : <StatisticsView projects={projects} />}
        </div>
      </div>
    </main>
  </>;
}
