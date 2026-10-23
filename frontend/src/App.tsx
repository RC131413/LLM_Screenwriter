import { useEffect, useState } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, LayoutList, Minus, Plus, RotateCcw, UsersRound } from 'lucide-react';
import { useSession } from './hooks/useSession';
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
import { RequestState } from './components/RequestState';
import { Modal } from './components/Modal';
import { IconButton } from './components/IconButton';
import { exportProject } from './services/export';
import { errorMessage } from './services/workspaceData';
import { isInTrash, projectsInCollection } from './services/projectLibrary';
import { screenplayModel } from './types';
import type { DashboardCollection, View } from './types';

export default function App() {
  const session = useSession();
  const workspace = useWorkspace(session.user?.id);
  const preferences = usePreferences(session.user?.id);
  const account = useProfile(session.user, session.refresh);
  const navigation = useProjectNavigation();
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
  const [operationError, setOperationError] = useState('');

  async function perform(action: () => Promise<unknown>) {
    setOperationError('');
    try { await action(); }
    catch (failure) { setOperationError(errorMessage(failure)); }
  }
  function selectScene(id: string) { setSceneId(id); setView('script'); if (window.innerWidth <= 1000) setSidebarOpen(false); }
  function switchProject(id: string) { void perform(async () => { await workspace.flush(); navigation.openProject(id); setSceneId(undefined); setView('script'); }); }
  function editProject(id: string) { setEditingProjectId(id); setModal('editProject'); }
  const logout = () => { void perform(async () => { await workspace.flush(); await session.logout(); }); };

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setModal(undefined); setDeletingProjectId(undefined); setOperationError(''); }, [navigation.projectId, navigation.settingsTab, navigation.authView, session.user?.id]);
  useEffect(() => {
    if (session.loading || session.error) return;
    if (session.user && navigation.authView) navigation.openDashboard();
    else if (!session.user && !navigation.authView) window.location.hash = '#login';
  }, [session.user?.id, session.loading, session.error, navigation.authView]);
  const openedProjectId = project?.id;
  useEffect(() => {
    if (openedProjectId) void workspace.projectAction(openedProjectId, 'open').catch(failure => setOperationError(errorMessage(failure)));
  }, [openedProjectId]);

  if (session.loading || session.loggingOut) return <RequestState loading />;
  if (session.error) return <RequestState error={session.error} onRetry={session.retry} />;
  if (!session.user || !account.profile) return <AuthPage key={navigation.authView ?? 'login'} mode={navigation.authView ?? 'login'} onSubmit={async data => {
    if ('identifier' in data) await session.login(data); else await session.register(data);
    navigation.openDashboard();
  }} />;
  if (workspace.loading || preferences.loading || (!preferences.preferences && !preferences.error)) return <RequestState loading />;
  if (workspace.loadError) return <RequestState error={workspace.loadError} onRetry={workspace.retry} />;
  if (preferences.error || !preferences.preferences) return <RequestState error={preferences.error} onRetry={preferences.retry} />;

  const profile = account.profile;
  const words = project ? project.scenes.flatMap(item => item.blocks).map(block => block.text).join(' ').trim().split(/\s+/).filter(Boolean).length : 0;
  const tabs = [{ id: 'script', label: 'Scenariusz', icon: FileText }, { id: 'outline', label: 'Struktura', icon: LayoutList }, { id: 'characters', label: 'Postacie', icon: UsersRound }] as const;
  return <div className={`app ${sidebarOpen ? 'has-sidebar' : ''} ${assistantOpen ? 'has-assistant' : ''}`}>
    {navigation.settingsTab ? <SettingsPage tab={navigation.settingsTab} onTab={navigation.openSettings} returnHref={navigation.returnHref} profile={profile} onProfileSave={account.saveProfile} preferences={preferences.preferences} onPreferencesSave={preferences.savePreferences} onPreferencesReset={preferences.resetPreferences} onLogout={logout} onPasswordChange={session.changePassword} projects={workspace.projects} /> : project ? <>
      <TopBar profile={profile} onAccountSettings={() => navigation.openSettings()} onLogout={logout} projects={workspace.projects.filter(item => !isInTrash(item))} project={project} onProject={switchProject} onNewProject={() => setModal('project')} onEditProject={() => editProject(project.id)} onSettings={() => setModal('settings')} onExport={() => setModal('export')} onSidebar={() => { setSidebarOpen(value => !value); if (window.innerWidth <= 760) setAssistantOpen(false); }} onAssistant={() => { setAssistantOpen(value => !value); if (window.innerWidth <= 1000) setSidebarOpen(false); }} sidebarOpen={sidebarOpen} assistantOpen={assistantOpen} />
      <div className="app-body">
        {sidebarOpen && <><button className="sidebar-backdrop" aria-label="Zamknij listę scen" onClick={() => setSidebarOpen(false)} /><SceneSidebar key={project.id} project={project} sceneId={scene?.id} onSelect={selectScene} onClose={() => setSidebarOpen(false)} /></>}
        <main className="main-workspace">
          <div className="workspace-nav"><div className="workspace-tabs" role="tablist" aria-label="Widoki projektu">{tabs.map(tab => <button key={tab.id} role="tab" id={`view-tab-${tab.id}`} aria-controls="workspace-content" aria-selected={view === tab.id} onClick={() => setView(tab.id)}><tab.icon size={15} />{tab.label}{tab.id === 'characters' && <span className="tab-count">{project.characters.length}</span>}</button>)}</div><span className="document-version">Wersja robocza</span></div>
          <div className="workspace-content" id="workspace-content" role="tabpanel" aria-labelledby={`view-tab-${view}`}>
            {view === 'script' ? scene ? <SceneEditor key={scene.id} scene={scene} sceneNumber={scene.scene_number} zoom={zoom} onChange={workspace.updateScene} onDelete={() => setModal('deleteScene')} undo={() => workspace.undo(scene.id)} redo={() => workspace.redo(scene.id)} canUndo={workspace.canUndo(scene.id)} canRedo={workspace.canRedo(scene.id)} /> : <div className="empty-view"><Clapperboard size={30} strokeWidth={1.4} /><h2>Pierwsza scena</h2><button className="button" onClick={() => setView('outline')}><LayoutList size={15} />Otwórz strukturę</button></div> : view === 'outline' ? <OutlineView project={project} onSelect={selectScene}
              onAdd={async act => { const id = await workspace.addScene(project.id, act); selectScene(id); }} onAddAct={() => workspace.addAct(project.id)}
              onSaveAct={act => workspace.editAct(project.id, act)} onRemoveAct={act => workspace.removeAct(project.id, act)}
              onMoveScene={(id, act) => workspace.moveScene(project.id, id, act)} onReorder={scenes => workspace.reorderScenes(project.id, scenes)} /> :
              <CharactersView key={project.id} project={project} onSave={character => workspace.saveCharacter(project.id, character)} onDelete={id => workspace.removeCharacter(project.id, id)} />}
          </div>
        </main>
        {assistantOpen && <AssistantPanel key={project.id} project={project} scene={scene} onSelect={selectScene} onChange={workspace.updateScene} onClose={() => setAssistantOpen(false)} onPrepare={workspace.flush}
          onApply={async variantId => { await workspace.applyVariant(project.id, variantId); setNotice('Wariant zapisany w scenie.'); }} />}
      </div>
    </> : <ProjectDashboard profile={profile} onAccountSettings={() => navigation.openSettings()} onLogout={logout} projects={workspace.projects} collection={dashboardCollection} onCollection={setDashboardCollection} onOpen={switchProject} onCreate={() => setModal('project')} onEdit={editProject} onDelete={setDeletingProjectId}
      onFavorite={id => void perform(() => workspace.projectAction(id, workspace.projects.find(item => item.id === id)?.metadata?.is_favorite ? 'unfavorite' : 'favorite'))}
      onArchive={id => void perform(() => workspace.projectAction(id, workspace.projects.find(item => item.id === id)?.metadata?.archived_at ? 'unarchive' : 'archive'))}
      onRestore={id => void perform(() => workspace.projectAction(id, 'restore'))} onSettings={() => setModal('preferences')} />}
    <footer className="statusbar"><div className={`save-status ${workspace.saveState}`}><span className="status-dot" /><span>{workspace.saveState === 'saved' ? 'Zapisano na serwerze' : workspace.saveState === 'saving' ? 'Zapisywanie…' : 'Błąd zapisu'}</span></div>{project ? <><div className="statusbar-center"><span>{project.title}</span><ChevronRight size={11} /><span>{scene?.title ?? 'Brak scen'}</span></div><div className="document-stats"><span>{words} słów</span><span>{project.scenes.length} scen</span><span className="format-label">Fountain</span></div></> : <span>Liczba projektów: {projectsInCollection(workspace.projects, dashboardCollection).length}</span>}</footer>
    {(operationError || workspace.error) && <div className="warning-banner" role="alert"><span>{operationError || workspace.error}</span>{workspace.error && <button onClick={workspace.retry}>Ponów zapis / odśwież</button>}<button onClick={() => setOperationError('')}>Zamknij</button></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {modal === 'preferences' && <PreferencesDialog preferences={preferences.preferences} onClose={() => setModal(undefined)} onSave={preferences.savePreferences} onReset={preferences.resetPreferences} />}
    {modal === 'settings' && <Modal title="Ustawienia edytora" onClose={() => setModal(undefined)}><div className="modal-body">
      <div className="settings-row"><span>Model</span><span className="muted">{screenplayModel}</span></div>
      <div className="settings-row"><span>Czcionka scenariusza</span><span className="muted">Courier New · 12 pt</span></div>
      <div className="settings-row"><span>Powiększenie widoku</span><div className="zoom-stepper"><IconButton label="Zmniejsz powiększenie" disabled={zoom <= 50} onClick={() => setZoom(value => value - 10)}><Minus size={15} /></IconButton><output aria-label="Powiększenie widoku">{zoom}%</output><IconButton label="Zwiększ powiększenie" disabled={zoom >= 200} onClick={() => setZoom(value => value + 10)}><Plus size={15} /></IconButton><IconButton label="Przywróć powiększenie 100%" disabled={zoom === 100} onClick={() => setZoom(100)}><RotateCcw size={14} /></IconButton></div></div>
      <div className="settings-row"><span>Zapis</span><span className="muted">PostgreSQL</span></div></div><div className="modal-actions"><button className="button primary" onClick={() => setModal(undefined)}>Gotowe</button></div></Modal>}
    {modal === 'export' && project && <Modal title="Eksport scenariusza" onClose={() => setModal(undefined)}><div className="modal-body"><p>{project.title}</p><label className="field-label spaced" htmlFor="export-format">Format pliku</label><select id="export-format" className="field-input" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'fountain' | 'json')}><option value="fountain">Fountain (.fountain)</option><option value="json">Projekt z kartami postaci (.json)</option></select></div><div className="modal-actions"><button className="button" onClick={() => setModal(undefined)}>Anuluj</button><button className="button primary" onClick={() => void perform(async () => { await workspace.flush(); exportProject(project, exportFormat); setModal(undefined); })}>Pobierz plik</button></div></Modal>}
    {(modal === 'project' || (modal === 'editProject' && editingProject)) && <ProjectDialog key={modal === 'editProject' ? editingProject?.id : 'new-project'} project={modal === 'editProject' ? editingProject : undefined} onClose={() => setModal(undefined)} onSave={async details => {
      if (modal === 'editProject' && editingProject) await workspace.editProject(editingProject.id, details);
      else { const next = await workspace.createProject(details); setDashboardCollection('all'); navigation.openProject(next.id); setSceneId(undefined); setView('outline'); }
      setModal(undefined);
    }} />}
    {modal === 'deleteScene' && project && scene && <Modal title="Usuń scenę" error={operationError || workspace.error} onClose={() => { if (!workspace.mutating) setModal(undefined); }}><div className="modal-body"><p>Usunąć trwale scenę „{scene.title}” wraz z historią generowania?</p></div><div className="modal-actions"><button className="button" disabled={workspace.mutating} onClick={() => setModal(undefined)}>Anuluj</button><button className="button danger" disabled={workspace.mutating} onClick={() => void perform(async () => { await workspace.removeScene(project.id, scene.id); setSceneId(undefined); setModal(undefined); })}>Usuń scenę</button></div></Modal>}
    {deletingProject && <Modal error={operationError || workspace.error} title={isInTrash(deletingProject) ? 'Usuń projekt trwale' : 'Przenieś projekt do kosza'} onClose={() => { if (!workspace.mutating) setDeletingProjectId(undefined); }}>
      <div className="modal-body"><p>{isInTrash(deletingProject) ? `Usunąć trwale projekt „${deletingProject.title}” i wszystkie powiązane dane?` : `Przenieść projekt „${deletingProject.title}” do kosza?`}</p><p>Akty: {deletingProject.acts.length} · Sceny: {deletingProject.scenes.length} · Postacie: {deletingProject.characters.length}</p></div>
      <div className="modal-actions"><button className="button" disabled={workspace.mutating} onClick={() => setDeletingProjectId(undefined)}>Anuluj</button><button className="button danger" disabled={workspace.mutating} onClick={() => void perform(async () => {
        if (isInTrash(deletingProject)) await workspace.removeProject(deletingProject.id); else await workspace.projectAction(deletingProject.id, 'trash');
        if (navigation.projectId === deletingProject.id) navigation.openDashboard(); setDeletingProjectId(undefined);
      })}>{isInTrash(deletingProject) ? 'Usuń trwale projekt' : 'Przenieś do kosza'}</button></div>
    </Modal>}
  </div>;
}
