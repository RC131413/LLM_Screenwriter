import { useState } from 'react';
import { FileText, FolderOpen, PanelLeft, Plus, Redo2, Search, Undo2, X } from 'lucide-react';
import type { DashboardCollection, Project } from '../types';
import { IconButton } from './IconButton';
import { DashboardSidebar } from './DashboardSidebar';
import { ProjectCard } from './ProjectCard';
import { collectionLabels, projectsInCollection } from '../services/projectLibrary';

interface Props {
  projects: Project[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onFavorite: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onSettings: () => void;
  collection: DashboardCollection;
  onCollection: (collection: DashboardCollection) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function ProjectDashboard({ projects, onOpen, onCreate, onEdit, onDelete, onFavorite, onArchive, onRestore, onSettings, collection, onCollection, undo, redo, canUndo, canRedo }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'added' | 'title'>('added');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1000);
  const collectionProjects = projectsInCollection(projects, collection);
  const search = query.trim().toLocaleLowerCase('pl');
  const visible = collectionProjects.filter(project =>
    [project.title, project.genre, project.logline, project.synopsis, project.target_audience]
      .some(value => value.toLocaleLowerCase('pl').includes(search)),
  );
  if (sort === 'title') visible.sort((a, b) => a.title.localeCompare(b.title, 'pl'));

  return <>
    <header className="topbar dashboard-topbar">
      <div className="brand"><FileText size={21} strokeWidth={1.6} /><span>LLM <strong>Screenwriter</strong></span></div>
      <span className="dashboard-location">{collectionLabels[collection]}</span>
      <div className="topbar-actions">
        <span className="demo-badge"><span className="status-dot" />Tryb demonstracyjny</span>
        <IconButton label="Menu projektów" aria-expanded={sidebarOpen} aria-pressed={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}><PanelLeft size={18} /></IconButton>
      </div>
    </header>
    <div className="dashboard-shell">
      {sidebarOpen && <><button className="dashboard-menu-backdrop" aria-label="Zamknij menu projektów" onClick={() => setSidebarOpen(false)} /><DashboardSidebar projects={projects} collection={collection} onCollection={next => { onCollection(next); setQuery(''); if (window.innerWidth <= 1000) setSidebarOpen(false); }} onOpen={onOpen} onClose={() => setSidebarOpen(false)} onSettings={() => { if (window.innerWidth <= 1000) setSidebarOpen(false); onSettings(); }} /></>}
    <main className="dashboard-main" id="dashboard-main">
      <div className="dashboard-content">
        <div className="dashboard-heading">
          <div><span className="eyebrow">PRZESTRZEŃ ROBOCZA</span><h1>{collectionLabels[collection]} <span>{collectionProjects.length}</span></h1></div>
          <button className="button primary dashboard-create" onClick={onCreate}><Plus size={17} />Nowy projekt</button>
        </div>
        <div className="dashboard-toolbar">
          <div className="dashboard-search"><Search size={15} /><input aria-label="Szukaj projektu" placeholder="Szukaj projektu…" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton label="Wyczyść wyszukiwanie" onClick={() => setQuery('')}><X size={14} /></IconButton>}</div>
          <select className="dashboard-sort" aria-label="Sortuj projekty" value={sort} onChange={event => setSort(event.target.value as 'added' | 'title')}><option value="added">{collection === 'recent' ? 'Ostatnio otwierane' : 'Kolejność dodania'}</option><option value="title">Tytuł A–Z</option></select>
          <div className="toolbar-group dashboard-history"><IconButton label="Cofnij zmianę" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></IconButton><IconButton label="Ponów zmianę" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></IconButton></div>
        </div>
        {collectionProjects.length === 0 ? <div className="dashboard-empty"><FolderOpen size={32} strokeWidth={1.4} /><h2>{collection === 'all' ? 'Brak projektów' : collection === 'trash' ? 'Kosz jest pusty' : collection === 'archive' ? 'Archiwum jest puste' : collection === 'favorites' ? 'Brak ulubionych projektów' : 'Brak ostatnio otwieranych projektów'}</h2>{collection === 'all' && <button className="button" onClick={onCreate}><Plus size={15} />Utwórz pierwszy projekt</button>}</div> : visible.length === 0 ? <div className="dashboard-empty"><Search size={28} strokeWidth={1.4} /><h2>Brak wyników</h2><button className="button" onClick={() => setQuery('')}><X size={14} />Wyczyść wyszukiwanie</button></div> : <div className="project-grid">
          {visible.map(project => <ProjectCard key={project.id} project={project} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onFavorite={onFavorite} onArchive={onArchive} onRestore={onRestore} />)}
        </div>}
      </div>
    </main>
    </div>
  </>;
}
