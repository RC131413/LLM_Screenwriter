import { useState } from 'react';
import { ArrowDown, ArrowRightLeft, ArrowUp, ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Act, Project, Scene } from '../types';
import { formatAct, statusLabels } from '../types';
import { errorMessage } from '../services/workspaceData';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

interface Props {
  project: Project;
  onSelect: (id: string) => void;
  onAdd: (act: number) => Promise<void>;
  onAddAct: () => Promise<void>;
  onSaveAct: (act: Act) => Promise<void>;
  onRemoveAct: (act: Act) => Promise<void>;
  onMoveScene: (sceneId: string, act: number) => Promise<void>;
  onReorder: (scenes: Scene[]) => Promise<void>;
}

export function OutlineView({ project, onSelect, onAdd, onAddAct, onSaveAct, onRemoveAct, onMoveScene, onReorder }: Props) {
  const [editingAct, setEditingAct] = useState<Act>();
  const [deletingAct, setDeletingAct] = useState<Act>();
  const [movingScene, setMovingScene] = useState<Scene>();
  const [targetAct, setTargetAct] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>, close?: () => void) {
    if (pending) return;
    setPending(true); setError('');
    try { await action(); close?.(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  function move(scene: Scene, direction: number) {
    const siblings = project.scenes.filter(item => item.act === scene.act);
    const other = siblings[siblings.indexOf(scene) + direction];
    if (!other) return;
    const next = [...project.scenes];
    const first = next.indexOf(scene); const second = next.indexOf(other);
    [next[first], next[second]] = [next[second], next[first]];
    void run(() => onReorder(next));
  }
  return <div className="workspace-view" aria-busy={pending}>
    <div className="view-heading"><div><span className="eyebrow">{project.title}</span><h2>Struktura scenariusza</h2></div>
      <div className="outline-actions"><span className="muted small">{project.acts.length} aktów · {project.scenes.length} scen</span>
        <button className="button" disabled={pending} onClick={() => void run(onAddAct)}><Plus size={15} />Dodaj akt</button>
      </div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <details className="metadata-disclosure project-description"><summary>Opis projektu</summary>
      <dl className="metadata-list"><dt>Grupa docelowa</dt><dd>{project.target_audience || 'Nie określono'}</dd><dt>Streszczenie</dt><dd>{project.synopsis || 'Nie określono'}</dd></dl>
    </details>
    <div className="act-columns">{project.acts.map(act => {
      const scenes = project.scenes.filter(scene => scene.act === act.act_number);
      return <section className="outline-act" key={act.id}>
        <div className="outline-act-heading"><h3>Akt {formatAct(act.act_number)}</h3><span>{scenes.length}</span>
          <div className="outline-act-actions">
            <IconButton disabled={pending} label={`Edytuj akt ${formatAct(act.act_number)}`} onClick={() => { setError(''); setEditingAct({ ...act }); }}><Pencil size={14} /></IconButton>
            <IconButton disabled={pending} label={`Dodaj scenę do aktu ${act.act_number}`} onClick={() => void run(() => onAdd(act.act_number))}><Plus size={17} /></IconButton>
            <IconButton disabled={pending || scenes.length > 0} label={scenes.length ? 'Przenieś lub usuń sceny przed usunięciem aktu' : `Usuń akt ${formatAct(act.act_number)}`} onClick={() => { setError(''); setDeletingAct(act); }}><Trash2 size={15} /></IconButton>
          </div></div>
        {act.title && <h4 className="act-title">{act.title}</h4>}{act.summary && <p className="act-summary">{act.summary}</p>}
        {scenes.map((scene, index) => <article className="outline-scene" key={scene.id}>
          <button className="outline-scene-link" onClick={() => onSelect(scene.id)}><span className="eyebrow">SCENA {String(scene.scene_number).padStart(2, '0')}</span><strong>{scene.title}<ArrowUpRight size={14} /></strong></button>
          <p>{scene.synopsis || 'Brak opisu sceny.'}</p><div className="outline-scene-footer"><span className={`status-label ${scene.status}`}>{statusLabels[scene.status]}</span>
            <IconButton label={`Przenieś scenę ${scene.title} do innego aktu`} disabled={pending || project.acts.length < 2} onClick={() => { setError(''); setMovingScene(scene); setTargetAct(project.acts.find(item => item.act_number !== scene.act)?.act_number ?? 0); }}><ArrowRightLeft size={14} /></IconButton>
            <IconButton label={`Przesuń scenę ${scene.title} w górę`} disabled={pending || index === 0} onClick={() => move(scene, -1)}><ArrowUp size={14} /></IconButton>
            <IconButton label={`Przesuń scenę ${scene.title} w dół`} disabled={pending || index === scenes.length - 1} onClick={() => move(scene, 1)}><ArrowDown size={14} /></IconButton>
          </div></article>)}
        {!scenes.length && <p className="empty-search">Brak scen w tym akcie.</p>}
      </section>;
    })}</div>
    {movingScene && <Modal title="Przenieś scenę" onClose={() => { if (!pending) setMovingScene(undefined); }}>
      <form onSubmit={event => { event.preventDefault(); void run(() => onMoveScene(movingScene.id, targetAct), () => setMovingScene(undefined)); }}>
        <div className="modal-body"><p>{movingScene.title || 'Bez tytułu'}</p><label className="field-label" htmlFor="move-target-act">Docelowy akt</label>
          <select id="move-target-act" className="field-input" value={targetAct} onChange={event => setTargetAct(Number(event.target.value))}>{project.acts.filter(act => act.act_number !== movingScene.act).map(act => <option key={act.id} value={act.act_number}>Akt {formatAct(act.act_number)}{act.title && ` · ${act.title}`}</option>)}</select>
          {error && <p className="form-error" role="alert">{error}</p>}</div>
        <div className="modal-actions"><button type="button" className="button" disabled={pending} onClick={() => setMovingScene(undefined)}>Anuluj</button><button type="submit" className="button primary" disabled={pending || !targetAct}><ArrowRightLeft size={15} />{pending ? 'Zapisywanie…' : 'Przenieś scenę'}</button></div>
      </form></Modal>}
    {editingAct && <Modal title={`Edytuj akt ${formatAct(editingAct.act_number)}`} onClose={() => { if (!pending) setEditingAct(undefined); }}>
      <form onSubmit={event => { event.preventDefault(); void run(() => onSaveAct({ ...editingAct, title: editingAct.title.trim() }), () => setEditingAct(undefined)); }}>
        <div className="modal-body"><label className="field-label" htmlFor="act-title">Tytuł aktu</label><input id="act-title" className="field-input" maxLength={255} value={editingAct.title} onChange={event => setEditingAct({ ...editingAct, title: event.target.value })} />
          <label className="field-label spaced" htmlFor="act-summary">Streszczenie wydarzeń w akcie</label><textarea id="act-summary" className="field-textarea" rows={7} value={editingAct.summary} onChange={event => setEditingAct({ ...editingAct, summary: event.target.value })} />
          {error && <p className="form-error" role="alert">{error}</p>}</div>
        <div className="modal-actions"><button type="button" className="button" disabled={pending} onClick={() => setEditingAct(undefined)}>Anuluj</button><button type="submit" className="button primary" disabled={pending}>{pending ? 'Zapisywanie…' : 'Zapisz akt'}</button></div>
      </form></Modal>}
    {deletingAct && <Modal title="Usuń akt" onClose={() => { if (!pending) setDeletingAct(undefined); }}>
      <div className="modal-body"><p>Usunąć pusty akt {formatAct(deletingAct.act_number)}? Operacja jest trwała.</p>{error && <p className="form-error" role="alert">{error}</p>}</div>
      <div className="modal-actions"><button className="button" disabled={pending} onClick={() => setDeletingAct(undefined)}>Anuluj</button><button className="button danger" disabled={pending} onClick={() => void run(() => onRemoveAct(deletingAct), () => setDeletingAct(undefined))}>Usuń akt</button></div>
    </Modal>}
  </div>;
}
