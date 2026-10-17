import { useEffect, useState } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, LayoutList, Minus, Plus, RotateCcw, Undo2, UsersRound } from 'lucide-react';
import { useWorkspace } from './hooks/useWorkspace';
import { useProjectNavigation } from './hooks/useProjectNavigation';
import { usePreferences } from './hooks/usePreferences';
import { useProfile } from './hooks/useProfile';
import { TopBar } from './components/TopBar';
import { SceneSidebar } from './components/SceneSidebar';
import { SceneEditor } from './components/SceneEditor';
import { AssistantPanel } from './components/AssistantPanel';
import { OutlineView } from './components/OutlineView';
import { CharactersView } from './components/CharactersView';
import { ProjectDialog } from './components/ProjectDialog';
import { ProjectDashboard } from './components/ProjectDashboard';
import { PreferencesDialog } from './components/PreferencesDialog';
import { SettingsPage } from './components/SettingsPage';
import { AuthPage } from './components/AuthPage';
import { Modal } from './components/Modal';
import { IconButton } from './components/IconButton';
import { exportProject } from './services/export';
import { isInTrash, projectsInCollection } from './services/projectLibrary';
import { createAct, newId, screenplayModel } from './types';
import type { DashboardCollection, Project, Scene, UserPreferences, View } from './types';

export default function App() {
  const workspace = useWorkspace();
  const navigation = useProjectNavigation();
  const preferences = usePreferences();
  const account = useProfile();
  const project = workspace.projects.find(item => item.id === navigation.projectId && !isInTrash(item));
  const [dashboardCollection, setDashboardCollection] = useState<DashboardCollection>('all');
  const [sceneId, setSceneId] = useState<string>();
  const scene = project?.scenes.find(item => item.id === sceneId) ?? project?.scenes[0];
  const [view, setView] = useState<View>('script');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1000);
  const [assistantOpen, setAssistantOpen] = useState(() => window.innerWidth > 760);
  const [modal, setModal] = useState<'settings' | 'preferences' | 'export' | 'project' | 'editProject' | 'deleteScene'>();
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const editingProject = workspace.projects.find(item => item.id === editingProjectId);
  const deletingProject = workspace.projects.find(item => item.id === deletingProjectId);
  const [zoom, setZoom] = useState(100);
  const [exportFormat, setExportFormat] = useState<'fountain' | 'json'>('fountain');
  const [notice, setNotice] = useState('');
  const [warningVisible, setWarningVisible] = useState(true);
  const updateProject = (next: Project) => workspace.updateProject(next.id, () => next);
  function updateScene(next: Scene) {
    if (!project) return;
    workspace.updateProject(project.id, current => ({ ...current, scenes: current.scenes.map(item => item.id === next.id ? next : item).sort((a, b) => a.act - b.act) }));
  }
  function selectScene(id: string) { setSceneId(id); setView('script'); if (window.innerWidth <= 1000) setSidebarOpen(false); }
  function switchProject(id: string) { navigation.openProject(id); setSceneId(workspace.projects.find(item => item.id === id)?.scenes[0]?.id); setView('script'); }
  function editProject(id: string) { setEditingProjectId(id); setModal('editProject'); }
  function toggleFavorite(id: string) {
    workspace.updateProject(id, current => ({ ...current, metadata: { ...current.metadata, is_favorite: !current.metadata?.is_favorite } }));
  }
  function toggleArchive(id: string) {
    workspace.updateProject(id, current => ({ ...current, metadata: { ...current.metadata, archived_at: current.metadata?.archived_at ? null : new Date().toISOString() } }));
  }
  function restoreProject(id: string) {
    workspace.updateProject(id, current => ({ ...current, metadata: { ...current.metadata, deleted_at: null } }));
  }
  function savePreferences(next: UserPreferences) {
    const saved = preferences.savePreferences(next);
    if (saved) setNotice('Preferencje zapisane.');
    return saved;
  }
  function addAct() {
    if (!project) return;
    workspace.updateProject(project.id, current => ({
      ...current, acts: [...current.acts, createAct(Math.max(0, ...current.acts.map(act => act.act_number)) + 1)],
    }));
  }
  function addScene(act: Scene['act']) {
    if (!project) return;
    const next: Scene = { id: newId(), title: 'Nowa scena', heading: 'WN. MIEJSCE — DZIEŃ', act, status: 'draft', synopsis: '', characterIds: [], notes: '', blocks: [{ id: newId(), type: 'action', text: '' }] };
    workspace.updateProject(project.id, current => {
      const insertAfter = current.scenes.findLastIndex(item => item.act <= act);
      const scenes = [...current.scenes]; scenes.splice(insertAfter + 1, 0, next);
      return { ...current, scenes };
    });
    selectScene(next.id);
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setModal(undefined); setDeletingProjectId(undefined); }, [navigation.projectId, navigation.settingsTab, navigation.authView]);
  const openedProjectId = project?.id;
  useEffect(() => { if (openedProjectId) workspace.markProjectOpened(openedProjectId); }, [openedProjectId, workspace.markProjectOpened]);
  const words = project ? project.scenes.flatMap(item => item.blocks).map(block => block.text).join(' ').trim().split(/\s+/).filter(Boolean).length : 0;
  const tabs = [{ id: 'script', label: 'Scenariusz', icon: FileText }, { id: 'outline', label: 'Struktura', icon: LayoutList }, { id: 'characters', label: 'Postacie', icon: UsersRound }] as const;
  if (navigation.authView) return <AuthPage key={navigation.authView} mode={navigation.authView} onSubmit={() => {
    setNotice(navigation.authView === 'register' ? 'Otwarto tryb demonstracyjny. Konto nie zostało utworzone.' : 'Otwarto tryb demonstracyjny. Logowanie wymaga połączenia z serwerem.');
    navigation.openDashboard();
  }} />;
  return <div className={`app ${sidebarOpen ? 'has-sidebar' : ''} ${assistantOpen ? 'has-assistant' : ''}`}>
    {navigation.settingsTab ? <SettingsPage tab={navigation.settingsTab} onTab={navigation.openSettings} returnHref={navigation.returnHref} profile={account.profile} onProfileSave={account.saveProfile} preferences={preferences.preferences} onPreferencesSave={savePreferences} projects={workspace.projects} /> : project ? <>
    <TopBar profile={account.profile} onAccountSettings={() => navigation.openSettings()} projects={workspace.projects.filter(item => !isInTrash(item))} project={project} onProject={switchProject} onNewProject={() => setModal('project')} onEditProject={() => editProject(project.id)} onSettings={() => setModal('settings')} onExport={() => setModal('export')} onSidebar={() => { setSidebarOpen(value => !value); if (window.innerWidth <= 760) setAssistantOpen(false); }} onAssistant={() => { setAssistantOpen(value => !value); if (window.innerWidth <= 1000) setSidebarOpen(false); }} sidebarOpen={sidebarOpen} assistantOpen={assistantOpen} />
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
    </> : <ProjectDashboard profile={account.profile} onAccountSettings={() => navigation.openSettings()} projects={workspace.projects} collection={dashboardCollection} onCollection={setDashboardCollection} onOpen={switchProject} onCreate={() => setModal('project')} onEdit={editProject} onDelete={setDeletingProjectId} onFavorite={toggleFavorite} onArchive={toggleArchive} onRestore={restoreProject} onSettings={() => setModal('preferences')} undo={() => { workspace.undo(); setNotice(''); }} redo={() => { workspace.redo(); setNotice(''); }} canUndo={workspace.canUndo} canRedo={workspace.canRedo} />}
    <footer className="statusbar"><div className={`save-status ${workspace.saveState}`}><span className="status-dot" /><span>{workspace.saveState === 'saved' ? 'Zapisano lokalnie' : workspace.saveState === 'saving' ? 'Zapisywanie…' : 'Błąd zapisu — wyeksportuj projekt'}</span></div>{project ? <><div className="statusbar-center"><span>{project.title}</span><ChevronRight size={11} /><span>{scene?.title ?? 'Brak scen'}</span></div><div className="document-stats"><span>{words} słów</span><span>{project.scenes.length} scen</span><span className="format-label">Fountain</span></div></> : <span>Liczba projektów: {projectsInCollection(workspace.projects, dashboardCollection).length}</span>}</footer>
    {warningVisible && workspace.warning && <div className="warning-banner" role="alert"><span>{workspace.warning}</span><button onClick={() => setWarningVisible(false)}>Zamknij</button></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {modal === 'preferences' && <PreferencesDialog preferences={preferences.preferences} onClose={() => setModal(undefined)} onSave={savePreferences} />}
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
    {modal === 'export' && project && <Modal title="Eksport scenariusza" onClose={() => setModal(undefined)}><div className="modal-body"><p className="export-project-name">{project.title}</p><p className="muted small">{project.scenes.length} scen · {words} słów</p><label className="field-label spaced" htmlFor="export-format">Format pliku</label><select id="export-format" className="field-input" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'fountain' | 'json')}><option value="fountain">Fountain (.fountain)</option><option value="json">Projekt z kartami postaci (.json)</option></select></div><div className="modal-actions"><button className="button" onClick={() => setModal(undefined)}>Anuluj</button><button className="button primary" onClick={() => { exportProject(project, exportFormat); setModal(undefined); setNotice('Plik przygotowany do pobrania.'); }}>Pobierz plik</button></div></Modal>}
    {(modal === 'project' || (modal === 'editProject' && editingProject)) && <ProjectDialog
      key={modal === 'editProject' ? editingProject?.id : 'new-project'}
      project={modal === 'editProject' ? editingProject : undefined}
      onClose={() => setModal(undefined)}
      onSave={details => {
        if (modal === 'editProject') {
          if (!editingProject) return;
          workspace.updateProject(editingProject.id, current => ({ ...current, ...details }));
        }
        else {
          const next: Project = { id: newId(), ...details, acts: [1, 2, 3].map(createAct), scenes: [], characters: [] };
          workspace.addProject(next); setDashboardCollection('all'); navigation.openProject(next.id); setSceneId(undefined); setView('outline');
        }
        setModal(undefined);
      }}
    />}
    {modal === 'deleteScene' && project && scene && <Modal title="Usuń scenę" onClose={() => setModal(undefined)}><div className="modal-body"><p>Usunąć scenę „{scene.title}”? Zmianę możesz cofnąć w edytorze.</p></div><div className="modal-actions"><button className="button" onClick={() => setModal(undefined)}>Anuluj</button><button className="button danger" onClick={() => { workspace.updateProject(project.id, current => ({ ...current, scenes: current.scenes.filter(item => item.id !== scene.id) })); setSceneId(undefined); setModal(undefined); }}>Usuń scenę</button></div></Modal>}
    {deletingProject && <Modal title={isInTrash(deletingProject) ? 'Usuń projekt trwale' : 'Przenieś projekt do kosza'} onClose={() => setDeletingProjectId(undefined)}>
      <div className="modal-body"><p>{isInTrash(deletingProject) ? `Usunąć trwale projekt „${deletingProject.title}” wraz ze wszystkimi aktami, scenami i postaciami?` : `Przenieść projekt „${deletingProject.title}” do kosza?`}</p><p className="delete-project-counts">Akty: {deletingProject.acts.length} · Sceny: {deletingProject.scenes.length} · Postacie: {deletingProject.characters.length}</p></div>
      <div className="modal-actions"><button className="button" onClick={() => setDeletingProjectId(undefined)}>Anuluj</button><button className="button danger" onClick={() => {
        const permanent = isInTrash(deletingProject);
        if (permanent) workspace.removeProject(deletingProject.id);
        else workspace.updateProject(deletingProject.id, current => ({ ...current, metadata: { ...current.metadata, deleted_at: new Date().toISOString() } }));
        if (navigation.projectId === deletingProject.id) navigation.openDashboard();
        setDeletingProjectId(undefined); setNotice(permanent ? 'Projekt usunięty. Zmianę możesz cofnąć na liście projektów.' : 'Projekt przeniesiony do kosza.');
      }}>{isInTrash(deletingProject) ? 'Usuń trwale projekt' : 'Przenieś do kosza'}</button></div>
    </Modal>}
  </div>;
}
