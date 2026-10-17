import { ArrowLeft, Download, PanelLeft, PanelRight, Pencil, Plus, Settings2 } from 'lucide-react';
import type { Project, UserProfile } from '../types';
import { IconButton } from './IconButton';
import { UserMenu } from './UserMenu';

interface Props {
  projects: Project[]; project: Project;
  onProject: (id: string) => void; onNewProject: () => void; onEditProject: () => void; onSettings: () => void; onExport: () => void;
  onSidebar: () => void; onAssistant: () => void; sidebarOpen: boolean; assistantOpen: boolean;
  profile: UserProfile; onAccountSettings: () => void;
}
export function TopBar(props: Props) {
  return <header className="topbar editor-topbar">
    <div className="brand"><strong>AgentDraft</strong></div>
    <div className="project-switcher">
      <span className="topbar-divider" />
      <select aria-label="Wybierz projekt" value={props.project.id} onChange={event => props.onProject(event.target.value)}>
        {props.projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select>
      <IconButton label="Edytuj projekt" onClick={props.onEditProject}><Pencil size={14} /></IconButton>
      <IconButton label="Nowy projekt" onClick={props.onNewProject}><Plus size={16} /></IconButton>
    </div>
    <div className="topbar-actions">
      <a className="editor-back-link" href="#projects" aria-label="Wróć do projektów"><ArrowLeft size={15} /><span>Projekty</span></a>
      <IconButton label="Lista scen" onClick={props.onSidebar} aria-pressed={props.sidebarOpen}><PanelLeft size={18} /></IconButton>
      <IconButton label="Panel asystenta" onClick={props.onAssistant} aria-pressed={props.assistantOpen}><PanelRight size={18} /></IconButton>
      <IconButton label="Ustawienia" onClick={props.onSettings}><Settings2 size={18} /></IconButton>
      <button className="button export-button" onClick={props.onExport}><Download size={15} /><span>Eksportuj</span></button>
    </div>
    <UserMenu profile={props.profile} onSettings={props.onAccountSettings} />
  </header>;
}
