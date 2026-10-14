import { ChevronDown, Clapperboard, Search, X } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../types';
import { formatAct } from '../types';
import { IconButton } from './IconButton';

interface Props { project: Project; sceneId: string | undefined; onSelect: (id: string) => void; onClose: () => void }
export function SceneSidebar({ project, sceneId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const visible = project.scenes.filter(scene => `${scene.title} ${scene.heading}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));
  return <aside className="scene-sidebar" aria-label="Lista scen">
    <div className="sidebar-project"><span className="eyebrow">PROJEKT</span><div className="sidebar-title"><h1>{project.title}</h1><IconButton className="mobile-only" label="Zamknij listę scen" onClick={onClose}><X size={17} /></IconButton></div><p>{project.genre}</p></div>
    <div className="sidebar-section-title"><span><Clapperboard size={15} />Sceny <small>{project.scenes.length}</small></span></div>
    <label className="scene-search"><Search size={14} /><input aria-label="Szukaj sceny" placeholder="Szukaj sceny…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <nav className="scene-list" aria-label="Sceny projektu">
      {project.acts.map(act => <section className="act-group" key={act}>
        <button className="act-heading" aria-expanded={query ? true : !collapsed.includes(act)} onClick={() => setCollapsed(current => current.includes(act) ? current.filter(item => item !== act) : [...current, act])}>
          <ChevronDown size={13} className={!query && collapsed.includes(act) ? 'collapsed' : ''} /><span>AKT {formatAct(act)}</span><small>{project.scenes.filter(scene => scene.act === act).length}</small>
        </button>
        {(query || !collapsed.includes(act)) && visible.filter(scene => scene.act === act).map(scene => <button key={scene.id} className={`scene-item ${scene.id === sceneId ? 'selected' : ''}`} onClick={() => onSelect(scene.id)} aria-current={scene.id === sceneId ? 'page' : undefined}>
          <span className="scene-number">{String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}</span><span className="scene-item-text"><strong>{scene.title}</strong><small>{scene.heading.replace(/^(WN\.|PL\.)\s*/, '').split(' — ')[0]}</small></span><span className={`scene-status-dot ${scene.status}`} title={scene.status === 'ready' ? 'Gotowa' : scene.status === 'review' ? 'Do sprawdzenia' : 'Szkic'} />
        </button>)}
      </section>)}
      {query && visible.length === 0 && <p className="empty-search">Brak pasujących scen.</p>}
    </nav>
    <div className="sidebar-bottom"><span className="eyebrow">LOGLINE</span><p>{project.logline}</p></div>
  </aside>;
}
