import { useEffect, useState } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, LayoutList, Minus, Plus, RotateCcw, Undo2, UsersRound } from 'lucide-react';
import { useWorkspace } from './hooks/useWorkspace';
import { TopBar } from './components/TopBar';
import { SceneSidebar } from './components/SceneSidebar';
import { SceneEditor } from './components/SceneEditor';
import { AssistantPanel } from './components/AssistantPanel';
import { OutlineView } from './components/OutlineView';
import { CharactersView } from './components/CharactersView';
import { Modal } from './components/Modal';
import { IconButton } from './components/IconButton';
import { exportProject } from './services/export';
import { newId, screenplayModel } from './types';
import type { Project, Scene, View } from './types';

export default function App() {
  const workspace = useWorkspace();
  const [projectId, setProjectId] = useState(workspace.projects[0].id);
  const project = workspace.projects.find(item => item.id === projectId) ?? workspace.projects[0];
  const [sceneId, setSceneId] = useState<string | undefined>(project.scenes[1]?.id ?? project.scenes[0]?.id);
  const scene = project.scenes.find(item => item.id === sceneId) ?? project.scenes[0];
  const [view, setView] = useState<View>('script');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1000);
  const [assistantOpen, setAssistantOpen] = useState(() => window.innerWidth > 760);
  const [modal, setModal] = useState<'settings' | 'export' | 'project' | 'deleteScene'>();
  const [zoom, setZoom] = useState(100);
  const [exportFormat, setExportFormat] = useState<'fountain' | 'json'>('fountain');
  const [projectDraft, setProjectDraft] = useState({ title: '', genre: '', logline: '' });
  const [notice, setNotice] = useState('');
  const [warningVisible, setWarningVisible] = useState(true);
  const updateProject = (next: Project) => workspace.updateProject(project.id, () => next);
  function updateScene(next: Scene) {
    workspace.updateProject(project.id, current => ({ ...current, scenes: current.scenes.map(item => item.id === next.id ? next : item).sort((a, b) => a.act - b.act) }));
  }
  function selectScene(id: string) { setSceneId(id); setView('script'); if (window.innerWidth <= 1000) setSidebarOpen(false); }
  function switchProject(id: string) { setProjectId(id); setSceneId(workspace.projects.find(item => item.id === id)?.scenes[0]?.id); setView('script'); }
  function addAct() {
    workspace.updateProject(project.id, current => ({
      ...current, acts: [...current.acts, Math.max(0, ...current.acts) + 1],
    }));
  }
  function addScene(act: Scene['act']) {
    const next: Scene = { id: newId(), title: 'Nowa scena', heading: 'WN. MIEJSCE — DZIEŃ', act, status: 'draft', synopsis: '', characterIds: [], notes: '', blocks: [{ id: newId(), type: 'action', text: '' }] };
    workspace.updateProject(project.id, current => {
      const insertAfter = current.scenes.findLastIndex(item => item.act <= act);
      const scenes = [...current.scenes]; scenes.splice(insertAfter + 1, 0, next);
      return { ...current, scenes };
    });
    selectScene(next.id);
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  const words = project.scenes.flatMap(item => item.blocks).map(block => block.text).join(' ').trim().split(/\s+/).filter(Boolean).length;
  const tabs = [{ id: 'script', label: 'Scenariusz', icon: FileText }, { id: 'outline', label: 'Struktura', icon: LayoutList }, { id: 'characters', label: 'Postacie', icon: UsersRound }] as const;
  return <div className={`app ${sidebarOpen ? 'has-sidebar' : ''} ${assistantOpen ? 'has-assistant' : ''}`}>
    <TopBar projects={workspace.projects} project={project} onProject={switchProject} onNewProject={() => { setProjectDraft({ title: '', genre: '', logline: '' }); setModal('project'); }} onSettings={() => setModal('settings')} onExport={() => setModal('export')} onSidebar={() => { setSidebarOpen(value => !value); if (window.innerWidth <= 760) setAssistantOpen(false); }} onAssistant={() => { setAssistantOpen(value => !value); if (window.innerWidth <= 1000) setSidebarOpen(false); }} sidebarOpen={sidebarOpen} assistantOpen={assistantOpen} />
    <div className="app-body">
      {sidebarOpen && <><button className="sidebar-backdrop" aria-label="Zamknij listę scen" onClick={() => setSidebarOpen(false)} /><SceneSidebar key={project.id} project={project} sceneId={scene?.id} onSelect={selectScene} onClose={() => setSidebarOpen(false)} /></>}
      <main className="main-workspace">
        <div className="workspace-nav"><div className="workspace-tabs" role="tablist" aria-label="Widoki projektu">{tabs.map(tab => <button key={tab.id} role="tab" id={`view-tab-${tab.id}`} aria-controls="workspace-content" aria-selected={view === tab.id} onClick={() => setView(tab.id)}><tab.icon size={15} />{tab.label}{tab.id === 'characters' && <span className="tab-count">{project.characters.length}</span>}</button>)}</div><span className="document-version">Wersja robocza</span></div>
        <div className="workspace-content" id="workspace-content" role="tabpanel" aria-labelledby={`view-tab-${view}`}>
          {view === 'script' ? scene ? <SceneEditor key={scene.id} scene={scene} sceneNumber={project.scenes.indexOf(scene) + 1} zoom={zoom} onChange={updateScene} onDelete={() => setModal('deleteScene')} undo={workspace.undo} redo={workspace.redo} canUndo={workspace.canUndo} canRedo={workspace.canRedo} /> : <div className="empty-view"><Clapperboard size={30} strokeWidth={1.4} /><h2>Pierwsza scena</h2><button className="button" onClick={() => setView('outline')}><LayoutList size={15} />Otwórz strukturę</button>{workspace.canUndo && <button className="button" onClick={workspace.undo}><Undo2 size={15} />Cofnij zmianę</button>}</div> : view === 'outline' ? <OutlineView project={project} onSelect={selectScene} onAdd={addScene} onAddAct={addAct} onChange={updateProject} undo={workspace.undo} redo={workspace.redo} canUndo={workspace.canUndo} canRedo={workspace.canRedo} /> : <CharactersView key={project.id} project={project} onChange={updateProject} />}
        </div>
      </main>
      {assistantOpen && <AssistantPanel project={project} scene={scene} onChange={updateScene} onClose={() => setAssistantOpen(false)} onApply={variant => { if (scene) { updateScene({ ...scene, blocks: variant.blocks, status: 'review' }); setNotice('Wariant zastosowany. Zmianę możesz cofnąć.'); } }} />}
    </div>
    <footer className="statusbar"><div className={`save-status ${workspace.saveState}`}><span className="status-dot" /><span>{workspace.saveState === 'saved' ? 'Zapisano lokalnie' : workspace.saveState === 'saving' ? 'Zapisywanie…' : 'Błąd zapisu — wyeksportuj projekt'}</span></div><div className="statusbar-center"><span>{project.title}</span><ChevronRight size={11} /><span>{scene?.title ?? 'Brak scen'}</span></div><div className="document-stats"><span>{words} słów</span><span>{project.scenes.length} scen</span><span className="format-label">Fountain</span></div></footer>
    {warningVisible && workspace.warning && <div className="warning-banner" role="alert"><span>{workspace.warning}</span><button onClick={() => setWarningVisible(false)}>Zamknij</button></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {modal === 'settings' && <Modal title="Ustawienia edytora" onClose={() => setModal(undefined)}>
      <div className="modal-body">
        <div className="settings-row"><span>Model w symulacji</span><span className="muted">{screenplayModel}</span></div>
        <div className="settings-row"><span>Czcionka scenariusza</span><span className="muted">Courier New · 12 pt</span></div>
        <div className="settings-row"><span>Powiększenie widoku</span><div className="zoom-stepper">
          <IconButton label="Zmniejsz powiększenie" disabled={zoom <= 50} onClick={() => setZoom(value => value - 10)}><Minus size={15} /></IconButton>
          <output aria-label="Powiększenie widoku">{zoom}%</output>
          <IconButton label="Zwiększ powiększenie" disabled={zoom >= 200} onClick={() => setZoom(value => value + 10)}><Plus size={15} /></IconButton>
          <IconButton label="Przywróć powiększenie 100%" disabled={zoom === 100} onClick={() => setZoom(100)}><RotateCcw size={14} /></IconButton>
        </div></div>
        <div className="settings-row"><span>Silnik</span><span className="muted">Mock · offline</span></div>
        <div className="settings-row"><span>Zapis</span><span className="muted">Ta przeglądarka</span></div>
      </div>
      <div className="modal-actions"><button className="button primary" onClick={() => setModal(undefined)}>Gotowe</button></div>
    </Modal>}
    {modal === 'export' && <Modal title="Eksport scenariusza" onClose={() => setModal(undefined)}><div className="modal-body"><p className="export-project-name">{project.title}</p><p className="muted small">{project.scenes.length} scen · {words} słów</p><label className="field-label spaced" htmlFor="export-format">Format pliku</label><select id="export-format" className="field-input" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'fountain' | 'json')}><option value="fountain">Fountain (.fountain)</option><option value="json">Projekt z kartami postaci (.json)</option></select></div><div className="modal-actions"><button className="button" onClick={() => setModal(undefined)}>Anuluj</button><button className="button primary" onClick={() => { exportProject(project, exportFormat); setModal(undefined); setNotice('Plik przygotowany do pobrania.'); }}>Pobierz plik</button></div></Modal>}
    {modal === 'project' && <Modal title="Nowy projekt" onClose={() => setModal(undefined)}><form onSubmit={event => { event.preventDefault(); if (!projectDraft.title.trim()) return; const next: Project = { id: newId(), ...projectDraft, title: projectDraft.title.trim(), acts: [1, 2, 3], scenes: [], characters: [] }; workspace.addProject(next); setProjectId(next.id); setSceneId(undefined); setView('outline'); setModal(undefined); }}><div className="modal-body"><label className="field-label" htmlFor="project-title">Tytuł</label><input id="project-title" className="field-input" required maxLength={120} value={projectDraft.title} onChange={event => setProjectDraft({ ...projectDraft, title: event.target.value })} /><label className="field-label spaced" htmlFor="project-genre">Gatunek</label><input id="project-genre" className="field-input" value={projectDraft.genre} onChange={event => setProjectDraft({ ...projectDraft, genre: event.target.value })} /><label className="field-label spaced" htmlFor="project-logline">Logline</label><textarea id="project-logline" className="field-textarea" rows={3} value={projectDraft.logline} onChange={event => setProjectDraft({ ...projectDraft, logline: event.target.value })} /></div><div className="modal-actions"><button type="button" className="button" onClick={() => setModal(undefined)}>Anuluj</button><button type="submit" className="button primary">Utwórz projekt</button></div></form></Modal>}
    {modal === 'deleteScene' && scene && <Modal title="Usuń scenę" onClose={() => setModal(undefined)}><div className="modal-body"><p>Usunąć scenę „{scene.title}”? Zmianę możesz cofnąć w edytorze.</p></div><div className="modal-actions"><button className="button" onClick={() => setModal(undefined)}>Anuluj</button><button className="button danger" onClick={() => { workspace.updateProject(project.id, current => ({ ...current, scenes: current.scenes.filter(item => item.id !== scene.id) })); setSceneId(undefined); setModal(undefined); }}>Usuń scenę</button></div></Modal>}
  </div>;
}
