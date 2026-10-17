import { useEffect, useState } from 'react';
import type { AuthView, SettingsTab } from '../types';

export const projectHref = (id: string) => `#project/${encodeURIComponent(id)}`;

function readLocation(): { projectId?: string; settingsTab?: SettingsTab; authView?: AuthView } {
  const hash = window.location.hash;
  if (!hash || hash === '#login' || hash === '#register') return { authView: hash === '#register' ? 'register' : 'login' };
  if (hash === '#settings' || hash.startsWith('#settings/')) {
    const tab = hash.slice('#settings/'.length);
    return { settingsTab: tab === 'ai' || tab === 'statistics' ? tab : 'account' };
  }
  if (!hash.startsWith('#project/')) return {};
  try { return { projectId: decodeURIComponent(hash.slice('#project/'.length)) || undefined }; }
  catch { return {}; }
}

export function useProjectNavigation() {
  const [location, setLocation] = useState(readLocation);
  const [returnHref, setReturnHref] = useState('#projects');
  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return {
    ...location,
    returnHref,
    openSettings: (tab: SettingsTab = 'account') => {
      if (!location.settingsTab) setReturnHref(location.projectId ? projectHref(location.projectId) : '#projects');
      window.location.hash = `#settings/${tab}`;
    },
    openProject: (id: string) => { window.location.hash = projectHref(id); },
    openDashboard: () => { window.location.hash = '#projects'; },
  };
}
