import { Archive, ArchiveRestore, ArrowUpRight, Clapperboard, FileText, Layers3, Pencil, RotateCcw, Star, Trash2, UsersRound } from 'lucide-react';
import type { Project } from '../types';
import { projectHref } from '../hooks/useProjectNavigation';
import { isArchived, isInTrash } from '../services/projectLibrary';
import { IconButton } from './IconButton';

interface Props {
  project: Project;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onFavorite: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}

export function ProjectCard({ project, onOpen, onEdit, onDelete, onFavorite, onArchive, onRestore }: Props) {
  const trashed = isInTrash(project);
  const archived = isArchived(project);
  const content = <>
    <h2>{project.title}</h2>
    <p className="project-card-description">{project.logline || project.synopsis || 'Brak opisu projektu.'}</p>
    {project.target_audience && <p className="project-card-audience">{project.target_audience}</p>}
    <div className="project-card-footer">
      <div className="project-card-counts"><span title="Akty"><Layers3 size={13} />{project.acts.length}<span className="sr-only"> aktów</span></span><span title="Sceny"><Clapperboard size={13} />{project.scenes.length}<span className="sr-only"> scen</span></span><span title="Postacie"><UsersRound size={13} />{project.characters.length}<span className="sr-only"> postaci</span></span></div>
      {!trashed && <span className="project-open-label">Otwórz edytor<ArrowUpRight size={15} /></span>}
    </div>
  </>;

  return <article className="project-card" aria-label={project.title}>
    <div className="project-card-header">
      <div className="project-card-category"><FileText size={18} strokeWidth={1.5} /><span>{project.genre || 'Bez gatunku'}</span></div>
      <div className="project-card-actions">
        {trashed ? <>
          <IconButton label={`Przywróć projekt ${project.title}`} onClick={() => onRestore(project.id)}><RotateCcw size={15} /></IconButton>
          <IconButton label={`Usuń trwale projekt ${project.title}`} onClick={() => onDelete(project.id)}><Trash2 size={15} /></IconButton>
        </> : <>
          {!archived && <IconButton className={project.metadata?.is_favorite ? 'is-favorite' : ''} label={`${project.metadata?.is_favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'} ${project.title}`} aria-pressed={Boolean(project.metadata?.is_favorite)} onClick={() => onFavorite(project.id)}><Star size={15} fill={project.metadata?.is_favorite ? 'currentColor' : 'none'} /></IconButton>}
          <IconButton label={`Edytuj projekt ${project.title}`} onClick={() => onEdit(project.id)}><Pencil size={15} /></IconButton>
          <IconButton label={`${archived ? 'Przywróć z archiwum' : 'Archiwizuj projekt'} ${project.title}`} onClick={() => onArchive(project.id)}>{archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</IconButton>
          <IconButton label={`Przenieś do kosza ${project.title}`} onClick={() => onDelete(project.id)}><Trash2 size={15} /></IconButton>
        </>}
      </div>
    </div>
    {trashed ? <div className="project-card-content">{content}</div> : <a className="project-card-link" href={projectHref(project.id)} aria-label={`Otwórz projekt ${project.title}`} onClick={event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onOpen(project.id);
    }}>{content}</a>}
  </article>;
}
