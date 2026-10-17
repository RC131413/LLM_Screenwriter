import type { DashboardCollection, Project } from '../types';

export const collectionLabels: Record<DashboardCollection, string> = {
  all: 'Projekty', recent: 'Ostatnio otwierane', favorites: 'Ulubione', archive: 'Archiwum', trash: 'Kosz',
};

export const isInTrash = (project: Project) => Boolean(project.metadata?.deleted_at);
export const isArchived = (project: Project) => Boolean(project.metadata?.archived_at);
export const isActiveProject = (project: Project) => !isInTrash(project) && !isArchived(project);

export function projectsInCollection(projects: Project[], collection: DashboardCollection): Project[] {
  const filtered = projects.filter(project => {
    if (collection === 'trash') return isInTrash(project);
    if (collection === 'archive') return !isInTrash(project) && isArchived(project);
    if (!isActiveProject(project)) return false;
    if (collection === 'favorites') return Boolean(project.metadata?.is_favorite);
    if (collection === 'recent') return Boolean(project.metadata?.last_opened_at);
    return true;
  });
  if (collection === 'recent') filtered.sort((a, b) =>
    (b.metadata?.last_opened_at ?? '').localeCompare(a.metadata?.last_opened_at ?? ''),
  );
  return filtered;
}
