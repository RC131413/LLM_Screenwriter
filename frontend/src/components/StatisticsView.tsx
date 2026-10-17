import { Archive, ArrowUpRight, BookOpenText, Clapperboard, Clock3, FolderOpen, UsersRound } from 'lucide-react';
import type { Project, SceneStatus } from '../types';
import { statusLabels } from '../types';
import { isArchived, isInTrash } from '../services/projectLibrary';
import { projectHref } from '../hooks/useProjectNavigation';

const number = new Intl.NumberFormat('pl-PL');
const date = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const wordsIn = (project: Project) => project.scenes.flatMap(scene => scene.blocks).reduce((total, block) => total + block.text.trim().split(/\s+/).filter(Boolean).length, 0);
const openedAt = (project: Project) => {
  const timestamp = Date.parse(project.metadata?.last_opened_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export function StatisticsView({ projects }: { projects: Project[] }) {
  const library = projects.filter(project => !isInTrash(project));
  const scenes = library.flatMap(project => project.scenes);
  const archived = library.filter(isArchived).length;
  const totalWords = library.reduce((total, project) => total + wordsIn(project), 0);
  const recent = [...library].filter(project => openedAt(project) > 0).sort((a, b) => openedAt(b) - openedAt(a));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today); day.setDate(day.getDate() - 6 + index);
    const next = new Date(day); next.setDate(next.getDate() + 1);
    return { day, count: recent.filter(project => openedAt(project) >= day.getTime() && openedAt(project) < next.getTime()).length };
  });
  const maxCount = Math.max(1, ...days.map(day => day.count));
  const metrics = [
    { label: 'Projekty', value: library.length, icon: FolderOpen },
    { label: 'Sceny', value: scenes.length, icon: Clapperboard },
    { label: 'Słowa scenariusza', value: totalWords, icon: BookOpenText },
    { label: 'Postacie', value: library.reduce((sum, project) => sum + project.characters.length, 0), icon: UsersRound },
  ];
  return <div className="statistics-view">
    <dl className="statistics-metrics">{metrics.map(metric => <div key={metric.label}><dt><metric.icon size={16} />{metric.label}</dt><dd>{number.format(metric.value)}</dd></div>)}</dl>
    <div className="statistics-library-summary"><FolderOpen size={14} />Aktywne: {library.length - archived}<Archive size={14} />Archiwum: {archived}<span>Bez projektów w koszu</span></div>
    <div className="statistics-columns">
      <section className="settings-section"><div className="settings-section-heading"><h2>Statusy scen</h2><span>{scenes.length ? Math.round(scenes.filter(scene => scene.status === 'ready').length / scenes.length * 100) : 0}% gotowych</span></div>
        <div className="scene-status-chart">{(['draft', 'review', 'ready'] as SceneStatus[]).map(status => {
          const count = scenes.filter(scene => scene.status === status).length;
          return <div key={status} className={`scene-status-row ${status}`}><div><span>{statusLabels[status]}</span><strong>{count}</strong></div><progress max={Math.max(1, scenes.length)} value={count} aria-label={`Sceny: ${statusLabels[status]}`} /></div>;
        })}</div>
      </section>
      <section className="settings-section"><div className="settings-section-heading"><h2>Ostatnie otwarcia</h2><span>7 dni</span></div>
        <figure className="activity-chart"><div className="activity-bars">{days.map(({ day, count }) => <div className="activity-day" key={day.toISOString()}><span className="activity-count">{count}</span><div className="activity-bar-track"><span style={{ height: `${count / maxCount * 100}%` }} /></div><time dateTime={`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`} title={day.toLocaleDateString('pl-PL')}>{day.toLocaleDateString('pl-PL', { weekday: 'short' })}</time></div>)}</div><figcaption>Ostatnie otwarcie każdego projektu</figcaption></figure>
      </section>
    </div>
    <section className="settings-section"><div className="settings-section-heading"><h2>Projekty w liczbach</h2><span>{library.length}</span></div>
      {library.length ? <div className="statistics-table-scroll"><table className="statistics-table"><thead><tr><th scope="col">Projekt</th><th scope="col">Sceny</th><th scope="col">Słowa</th><th scope="col">Postacie</th><th scope="col">Ostatnio otwierany</th></tr></thead><tbody>{library.map(project => <tr key={project.id}><th scope="row"><a href={projectHref(project.id)}>{project.title}<ArrowUpRight size={13} /></a><span>{project.genre || 'Bez gatunku'}{isArchived(project) ? ' · Archiwum' : ''}</span></th><td>{project.scenes.length}</td><td>{number.format(wordsIn(project))}</td><td>{project.characters.length}</td><td>{openedAt(project) ? date.format(openedAt(project)) : 'Jeszcze nie otwierany'}</td></tr>)}</tbody></table></div> : <p className="settings-empty">Brak projektów.</p>}
    </section>
    <section className="settings-section"><div className="settings-section-heading"><h2>Ostatnia aktywność</h2><Clock3 size={16} /></div>
      {recent.length ? <ul className="recent-activity">{recent.slice(0, 5).map(project => <li key={project.id}><Clock3 size={15} /><div><a href={projectHref(project.id)}>{project.title}</a><span>Otwarcie projektu</span></div><time dateTime={new Date(openedAt(project)).toISOString()}>{date.format(openedAt(project))}</time></li>)}</ul> : <p className="settings-empty">Brak ostatnio otwieranych projektów.</p>}
    </section>
  </div>;
}
