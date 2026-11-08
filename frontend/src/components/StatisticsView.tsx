import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Project, SceneStatus } from '../types';
import { statusLabels } from '../types';
import { isArchived, isInTrash } from '../services/projectLibrary';
import { projectHref } from '../hooks/useProjectNavigation';
import { api } from '../services/api';
import type { ApiRecentActivity, ApiStatistics } from '../services/api';
import { errorMessage } from '../services/workspaceData';
import { RequestState } from './RequestState';

const number = new Intl.NumberFormat('pl-PL');
const date = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const wordsIn = (project: Project) => project.scenes.flatMap(scene => scene.blocks).reduce((total, block) => total + block.text.trim().split(/\s+/).filter(Boolean).length, 0);
const openedAt = (project: Project) => {
  const timestamp = Date.parse(project.metadata?.last_opened_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const activityLabels: Record<ApiRecentActivity['action'], string> = {
  create: 'Utworzenie projektu', edit: 'Edycja projektu', open: 'Otwarcie projektu',
  favorite: 'Dodanie do ulubionych', unfavorite: 'Usunięcie z ulubionych',
  archive: 'Przeniesienie do archiwum', unarchive: 'Przywrócenie z archiwum',
  trash: 'Przeniesienie do kosza', restore: 'Przywrócenie z kosza',
  generation_completed: 'Zakończone generowanie', generation_failed: 'Nieudane generowanie',
  generation_cancelled: 'Anulowane generowanie',
};

export function StatisticsView({ projects, onPrepare }: { projects: Project[]; onPrepare?: () => Promise<void> }) {
  const [statistics, setStatistics] = useState<ApiStatistics | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void (async () => {
      await onPrepare?.();
      if (controller.signal.aborted) return;
      const value = await api.account.getStatistics({ signal: controller.signal });
      if (!controller.signal.aborted) setStatistics(value);
    })()
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [version, onPrepare]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setVersion(value => value + 1); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const library = projects.filter(project => !isInTrash(project));
  const scenes = library.flatMap(project => project.scenes);
  const archived = library.filter(isArchived).length;
  const totalWords = library.reduce((total, project) => total + wordsIn(project), 0);
  const trashed = projects.filter(isInTrash).length;
  const generationCounts = new Map(statistics?.project_generations.map(item => [String(item.project_id), item]));
  const recent = statistics?.recent_activity ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today); day.setDate(day.getDate() - 6 + index);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return { day, count: statistics?.prompt_activity.find(item => item.date === key)?.count ?? 0 };
  });
  const maxCount = Math.max(1, ...days.map(day => day.count));
  const metrics = [
    { label: 'Projekty', value: library.length },
    { label: 'Sceny', value: scenes.length },
    { label: 'Słowa scenariusza', value: totalWords },
    { label: 'Postacie', value: library.reduce((sum, project) => sum + project.characters.length, 0) },
  ];
  if (error || !statistics) return <RequestState loading={!error} error={error} onRetry={() => setVersion(value => value + 1)} />;
  return <div className="statistics-view">
    <dl className="statistics-metrics">{metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{number.format(metric.value)}</dd></div>)}</dl>
    <div className="statistics-library-summary"><span>Aktywne: {library.length - archived}</span><span>Archiwum: {archived}</span><span>Kosz: {trashed}</span></div>
    <div className="statistics-columns">
      <section className="settings-section"><div className="settings-section-heading"><h2>Statusy scen</h2></div>
        <div className="scene-status-chart">{(['draft', 'review', 'ready'] as SceneStatus[]).map(status => {
          const count = scenes.filter(scene => scene.status === status).length;
          return <div key={status} className={`scene-status-row ${status}`}><div><span>{statusLabels[status]}</span><strong>{count}</strong></div><progress max={Math.max(1, scenes.length)} value={count} aria-label={`Sceny: ${statusLabels[status]}`} /></div>;
        })}</div>
      </section>
      <section className="settings-section"><div className="settings-section-heading"><h2>Wysłane prompty</h2><span>7 dni</span></div>
        <figure className="activity-chart" aria-label="Liczba wysłanych promptów w ostatnich siedmiu dniach"><div className="activity-bars">{days.map(({ day, count }) => <div className="activity-day" key={day.toISOString()}><span className="activity-count">{count}</span><div className="activity-bar-track"><span style={{ height: `${count / maxCount * 100}%` }} /></div><time dateTime={`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`} title={day.toLocaleDateString('pl-PL')}>{day.toLocaleDateString('pl-PL', { weekday: 'short' })}</time></div>)}</div></figure>
      </section>
    </div>
    <section className="settings-section"><div className="settings-section-heading"><h2>Projekty w liczbach</h2></div>
      {library.length ? <div className="statistics-table-scroll" role="region" aria-label="Statystyki projektów" tabIndex={0}><table className="statistics-table"><thead><tr><th scope="col">Projekt</th><th scope="col" className="statistics-number">Sceny</th><th scope="col" className="statistics-number">Słowa</th><th scope="col" className="statistics-number">Postacie</th><th scope="col" className="statistics-number statistics-generations">Udane generowania</th><th scope="col" className="statistics-number statistics-generations">Nieudane generowania</th><th scope="col">Ostatnio otwierany</th></tr></thead><tbody>{library.map(project => <tr key={project.id}><th scope="row"><a href={projectHref(project.id)}>{project.title}<ArrowUpRight size={13} /></a><span>{project.genre || 'Bez gatunku'}{isArchived(project) ? ' · Archiwum' : ''}</span></th><td className="statistics-number">{number.format(project.scenes.length)}</td><td className="statistics-number">{number.format(wordsIn(project))}</td><td className="statistics-number">{number.format(project.characters.length)}</td><td className="statistics-number">{number.format(generationCounts.get(project.id)?.completed_runs ?? 0)}</td><td className="statistics-number">{number.format(generationCounts.get(project.id)?.failed_runs ?? 0)}</td><td>{openedAt(project) ? date.format(openedAt(project)) : 'Jeszcze nie otwierany'}</td></tr>)}</tbody></table></div> : <p className="settings-empty">Brak projektów.</p>}
    </section>
    <section className="settings-section"><div className="settings-section-heading"><h2>Ostatnia aktywność</h2></div>
      {recent.length ? <ul className="recent-activity">{recent.slice(0, 5).map(activity => <li key={activity.id}><div>
        {projects.some(project => project.id === String(activity.project_id) && isInTrash(project))
          ? <span className="recent-project-title">{activity.project_title}</span>
          : <a href={projectHref(String(activity.project_id))}>{activity.project_title}</a>}
        <span>{activityLabels[activity.action]}</span>
      </div><time dateTime={activity.occurred_at}>{date.format(new Date(activity.occurred_at))}</time></li>)}</ul> : <p className="settings-empty">Brak ostatniej aktywności.</p>}
    </section>
  </div>;
}
