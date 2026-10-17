import { useEffect, useState } from 'react';

export const projectHref = (id: string) => `#project/${encodeURIComponent(id)}`;

function readProjectId(): string | undefined {
  if (!window.location.hash.startsWith('#project/')) return undefined;
  try { return decodeURIComponent(window.location.hash.slice('#project/'.length)) || undefined; }
  catch { return undefined; }
}

export function useProjectNavigation() {
  const [projectId, setProjectId] = useState(readProjectId);
  useEffect(() => {
    const sync = () => setProjectId(readProjectId());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return {
    projectId,
    openProject: (id: string) => { window.location.hash = projectHref(id); },
    openDashboard: () => { window.location.hash = '#projects'; },
  };
}
