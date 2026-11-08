import { ChevronDown, Clapperboard, Search, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { formatAct } from '../types';
import { IconButton } from './IconButton';
import { AiSettingsButton } from './AiSettingsButton';

interface Props { project: Project; sceneId: string | undefined; onSelect: (id: string) => void; onClose: () => void; onSettings: () => void }
export function SceneSidebar({ project, sceneId, onSelect, onClose, onSettings }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [loglineExpanded, setLoglineExpanded] = useState(false);
  const [loglineOverflows, setLoglineOverflows] = useState(false);
  const logline = useRef<HTMLParagraphElement>(null);
  const loglineId = `sidebar-logline-${project.id}`;
  useLayoutEffect(() => {
    setLoglineExpanded(false);
    const paragraph = logline.current;
    if (!paragraph) return;
    paragraph.scrollTop = 0;
    const measure = () => {
      const threeLines = parseFloat(getComputedStyle(paragraph).lineHeight) * 3;
      setLoglineOverflows(paragraph.scrollHeight > Math.min(threeLines, paragraph.clientHeight) + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    return () => observer.disconnect();
  }, [project.id, project.logline]);
  function toggleLogline() {
    if (logline.current) logline.current.scrollTop = 0;
    setLoglineExpanded(value => !value);
  }
  const visible = project.scenes.filter(scene => `${scene.title} ${scene.heading}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));
  return <aside className="scene-sidebar" aria-label="Lista scen">
    <div className="sidebar-scene-browser">
    <div className="sidebar-project"><span className="eyebrow">PROJEKT</span><div className="sidebar-title"><h1>{project.title}</h1><IconButton className="mobile-only" label="Zamknij listę scen" onClick={onClose}><X size={17} /></IconButton></div><p>{project.genre}</p></div>
    <div className="sidebar-section-title"><span><Clapperboard size={15} />Sceny <small>{project.scenes.length}</small></span></div>
    <label className="scene-search"><Search size={14} /><input aria-label="Szukaj sceny" placeholder="Szukaj sceny…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <nav className="scene-list" aria-label="Sceny projektu" tabIndex={0}>
      {project.acts.map(({ act_number: act, title }) => <section className="act-group" key={act}>
        <button className="act-heading" aria-expanded={query ? true : !collapsed.includes(act)} onClick={() => setCollapsed(current => current.includes(act) ? current.filter(item => item !== act) : [...current, act])}>
          <ChevronDown size={13} className={!query && collapsed.includes(act) ? 'collapsed' : ''} /><span>AKT {formatAct(act)}{title && ` · ${title}`}</span><small>{project.scenes.filter(scene => scene.act === act).length}</small>
        </button>
        {(query || !collapsed.includes(act)) && visible.filter(scene => scene.act === act).map(scene => <button key={scene.id} className={`scene-item ${scene.id === sceneId ? 'selected' : ''}`} onClick={() => onSelect(scene.id)} aria-current={scene.id === sceneId ? 'page' : undefined}>
          <span className="scene-number">{String(scene.scene_number).padStart(2, '0')}</span><span className="scene-item-text"><strong>{scene.title}</strong><small>{scene.heading.replace(/^(WN\.|PL\.)\s*/, '').split(' — ')[0]}</small></span><span className={`scene-status-dot ${scene.status}`} title={scene.status === 'ready' ? 'Gotowa' : scene.status === 'review' ? 'Do sprawdzenia' : 'Szkic'} />
        </button>)}
      </section>)}
      {query && visible.length === 0 && <p className="empty-search">Brak pasujących scen.</p>}
    </nav>
    </div>
    <div className="sidebar-bottom">
      <div className="sidebar-logline-heading"><span className="eyebrow">LOGLINE</span>
        {loglineOverflows && <button type="button" className="sidebar-logline-toggle" aria-label={loglineExpanded ? 'Zwiń logline' : 'Rozwiń logline'} aria-expanded={loglineExpanded} aria-controls={loglineId} onClick={toggleLogline}>
          {loglineExpanded ? 'Zwiń' : 'Rozwiń'}<ChevronDown size={12} className={loglineExpanded ? 'expanded' : ''} />
        </button>}
      </div>
      <p ref={logline} id={loglineId} className={`sidebar-logline${loglineExpanded ? ' is-expanded' : ''}`} tabIndex={loglineExpanded ? 0 : undefined}>{project.logline}</p>
    </div>
    <div className="dashboard-sidebar-footer"><AiSettingsButton onClick={onSettings} /></div>
  </aside>;
}
