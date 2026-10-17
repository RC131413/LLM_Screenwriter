import { Archive, Clock3, FileText, FolderOpen, Settings, Star, Trash2, X } from 'lucide-react';
import type { DashboardCollection, Project } from '../types';
import { collectionLabels, projectsInCollection } from '../services/projectLibrary';
import { IconButton } from './IconButton';
import { projectHref } from '../hooks/useProjectNavigation';

interface Props {
  projects: Project[];
  collection: DashboardCollection;
  onCollection: (collection: DashboardCollection) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onClose: () => void;
}

export function DashboardSidebar({ projects, collection, onCollection, onOpen, onSettings, onClose }: Props) {
  const items = [
    { id: 'all', label: 'Wszystkie projekty', icon: FolderOpen },
    { id: 'recent', label: collectionLabels.recent, icon: Clock3 },
    { id: 'favorites', label: collectionLabels.favorites, icon: Star },
    { id: 'archive', label: collectionLabels.archive, icon: Archive },
    { id: 'trash', label: collectionLabels.trash, icon: Trash2 },
  ] as const;
  const recent = projectsInCollection(projects, 'recent').slice(0, 5);

  return <aside className="dashboard-sidebar" aria-label="Nawigacja projektów">
    <div className="dashboard-sidebar-heading"><span className="eyebrow">BIBLIOTEKA</span><IconButton className="dashboard-menu-close" label="Zamknij menu projektów" onClick={onClose}><X size={16} /></IconButton></div>
    <nav className="dashboard-library-nav" aria-label="Biblioteka projektów">
      {items.map(item => <button key={item.id} className={collection === item.id ? 'selected' : ''} aria-current={collection === item.id ? 'page' : undefined} onClick={() => onCollection(item.id)}><item.icon size={16} /><span>{item.label}</span><small>{projectsInCollection(projects, item.id).length}</small></button>)}
    </nav>
    <div className="dashboard-recents"><span className="eyebrow">OSTATNIO OTWIERANE</span>
      {recent.length ? <nav aria-label="Ostatnie projekty">{recent.map(project => <a key={project.id} href={projectHref(project.id)} onClick={event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onOpen(project.id);
      }}><FileText size={14} /><span>{project.title}</span></a>)}</nav> : <p>Brak ostatnich projektów.</p>}
    </div>
    <div className="dashboard-sidebar-footer"><button className="dashboard-settings-button" onClick={onSettings}><Settings size={18} /><span>Ustawienia i AI</span></button></div>
  </aside>;
}
