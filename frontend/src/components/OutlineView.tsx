import { useState } from 'react';
import { ArrowDown, ArrowRightLeft, ArrowUp, ArrowUpRight, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { Act, Project, Scene } from '../types';
import { formatAct, statusLabels } from '../types';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

interface Props {
  project: Project;
  onSelect: (id: string) => void;
  onAdd: (act: Scene['act']) => void;
  onAddAct: () => void;
  onChange: (project: Project) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function OutlineView({ project, onSelect, onAdd, onAddAct, onChange, undo, redo, canUndo, canRedo }: Props) {
  const [deletingAct, setDeletingAct] = useState<number>();
  const [editingAct, setEditingAct] = useState<Act>();
  const [movingSceneId, setMovingSceneId] = useState<string>();
  const [targetAct, setTargetAct] = useState(0);
  const movingScene = project.scenes.find(scene => scene.id === movingSceneId);
  function removeAct(act: number) {
    onChange({
      ...project,
      acts: project.acts.filter(item => item.act_number !== act),
      scenes: project.scenes.filter(scene => scene.act !== act),
    });
    setDeletingAct(undefined);
  }
  function requestRemoval(act: number) {
    if (project.scenes.some(scene => scene.act === act)) setDeletingAct(act);
    else removeAct(act);
  }
  function move(scene: Scene, direction: number) {
    const siblings = project.scenes.filter(item => item.act === scene.act);
    const other = siblings[siblings.indexOf(scene) + direction];
    if (!other) return;
    const next = [...project.scenes];
    const index = next.indexOf(scene); const otherIndex = next.indexOf(other);
    [next[index], next[otherIndex]] = [next[otherIndex], next[index]];
    onChange({ ...project, scenes: next });
  }
  return <div className="workspace-view">
    <div className="view-heading">
      <div><span className="eyebrow">{project.title}</span><h2>Struktura scenariusza</h2></div>
      <div className="outline-actions">
        <span className="muted small">{project.acts.length} aktów · {project.scenes.length} scen</span>
        <div className="toolbar-group">
          <IconButton label="Cofnij zmianę" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></IconButton>
          <IconButton label="Ponów zmianę" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></IconButton>
        </div>
        <button className="button" onClick={onAddAct}><Plus size={15} />Dodaj akt</button>
      </div>
    </div>
    <details className="metadata-disclosure project-description">
      <summary>Opis projektu</summary>
      <dl className="metadata-list">
        <dt>Grupa docelowa</dt><dd>{project.target_audience || 'Nie określono'}</dd>
        <dt>Streszczenie</dt><dd>{project.synopsis || 'Nie określono'}</dd>
      </dl>
    </details>
    <div className="act-columns">{project.acts.map(act => {
      const number = act.act_number;
      const scenes = project.scenes.filter(scene => scene.act === number);
      return <section className="outline-act" key={number}>
        <div className="outline-act-heading">
          <h3>Akt {formatAct(number)}</h3><span>{scenes.length}</span>
          <div className="outline-act-actions">
            <IconButton label={`Edytuj akt ${formatAct(number)}`} onClick={() => setEditingAct({ ...act })}><Pencil size={14} /></IconButton>
            <IconButton label={`Dodaj scenę do aktu ${number}`} onClick={() => onAdd(number)}><Plus size={17} /></IconButton>
            <IconButton label={`Usuń akt ${formatAct(number)}`} onClick={() => requestRemoval(number)}><Trash2 size={15} /></IconButton>
          </div>
        </div>
        {act.title && <h4 className="act-title">{act.title}</h4>}
        {act.summary && <p className="act-summary">{act.summary}</p>}
        {scenes.map((scene, index) => <article className="outline-scene" key={scene.id}>
          <button className="outline-scene-link" onClick={() => onSelect(scene.id)}>
            <span className="eyebrow">SCENA {String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}</span>
            <strong>{scene.title}<ArrowUpRight size={14} /></strong>
          </button>
          <p>{scene.synopsis || 'Brak opisu sceny.'}</p>
          <div className="outline-scene-footer">
            <span className={`status-label ${scene.status}`}>{statusLabels[scene.status]}</span>
            <IconButton label={`Przenieś scenę ${scene.title} do innego aktu`} disabled={project.acts.length < 2} onClick={() => {
              setMovingSceneId(scene.id); setTargetAct(project.acts.find(act => act.act_number !== scene.act)?.act_number ?? 0);
            }}><ArrowRightLeft size={14} /></IconButton>
            <IconButton label={`Przesuń scenę ${scene.title} w górę`} disabled={index === 0} onClick={() => move(scene, -1)}><ArrowUp size={14} /></IconButton>
            <IconButton label={`Przesuń scenę ${scene.title} w dół`} disabled={index === scenes.length - 1} onClick={() => move(scene, 1)}><ArrowDown size={14} /></IconButton>
          </div>
        </article>)}
        {scenes.length === 0 && <p className="empty-search">Brak scen w tym akcie.</p>}
      </section>;
    })}</div>
    {movingScene && <Modal title="Przenieś scenę" onClose={() => setMovingSceneId(undefined)}>
      <form onSubmit={event => {
        event.preventDefault();
        if (targetAct === movingScene.act || !project.acts.some(act => act.act_number === targetAct)) return;
        const scenes = project.scenes.filter(scene => scene.id !== movingScene.id);
        const insertAfter = scenes.findLastIndex(scene => scene.act <= targetAct);
        scenes.splice(insertAfter + 1, 0, { ...movingScene, act: targetAct });
        onChange({ ...project, scenes }); setMovingSceneId(undefined);
      }}>
        <div className="modal-body"><p className="move-scene-name">{movingScene.title || 'Bez tytułu'}</p><p className="muted small">Akt {formatAct(movingScene.act)}</p>
          <label className="field-label spaced" htmlFor="move-target-act">Docelowy akt</label>
          <select id="move-target-act" className="field-input" value={targetAct} onChange={event => setTargetAct(Number(event.target.value))}>{project.acts.filter(act => act.act_number !== movingScene.act).map(act => <option key={act.act_number} value={act.act_number}>Akt {formatAct(act.act_number)}{act.title && ` · ${act.title}`}</option>)}</select>
        </div>
        <div className="modal-actions"><button type="button" className="button" onClick={() => setMovingSceneId(undefined)}>Anuluj</button><button type="submit" className="button primary" disabled={!project.acts.some(act => act.act_number === targetAct) || targetAct === movingScene.act}><ArrowRightLeft size={15} />Przenieś scenę</button></div>
      </form>
    </Modal>}
    {editingAct && <Modal title={`Edytuj akt ${formatAct(editingAct.act_number)}`} onClose={() => setEditingAct(undefined)}>
      <form onSubmit={event => {
        event.preventDefault();
        onChange({ ...project, acts: project.acts.map(act => act.act_number === editingAct.act_number ? { ...editingAct, title: editingAct.title.trim() } : act) });
        setEditingAct(undefined);
      }}>
        <div className="modal-body">
          <label className="field-label" htmlFor="act-title">Tytuł aktu</label>
          <input id="act-title" name="title" className="field-input" maxLength={255} value={editingAct.title} onChange={event => setEditingAct({ ...editingAct, title: event.target.value })} />
          <label className="field-label spaced" htmlFor="act-summary">Streszczenie wydarzeń w akcie</label>
          <textarea id="act-summary" name="summary" className="field-textarea" rows={7} value={editingAct.summary} onChange={event => setEditingAct({ ...editingAct, summary: event.target.value })} />
        </div>
        <div className="modal-actions"><button type="button" className="button" onClick={() => setEditingAct(undefined)}>Anuluj</button><button type="submit" className="button primary">Zapisz akt</button></div>
      </form>
    </Modal>}
    {deletingAct !== undefined && <Modal title={`Usuń akt ${formatAct(deletingAct)}`} onClose={() => setDeletingAct(undefined)}>
      <div className="modal-body"><p>Usunąć akt {formatAct(deletingAct)} i wszystkie przypisane do niego sceny ({project.scenes.filter(scene => scene.act === deletingAct).length})? Operację możesz cofnąć w strukturze.</p></div>
      <div className="modal-actions"><button className="button" onClick={() => setDeletingAct(undefined)}>Anuluj</button><button className="button danger" onClick={() => removeAct(deletingAct)}>Usuń akt i sceny</button></div>
    </Modal>}
  </div>;
}
