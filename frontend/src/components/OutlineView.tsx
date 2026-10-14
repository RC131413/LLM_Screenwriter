import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { Project, Scene } from '../types';
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
  function removeAct(act: number) {
    onChange({
      ...project,
      acts: project.acts.filter(number => number !== act),
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
  return <div className="workspace-view"><div className="view-heading"><div><span className="eyebrow">{project.title}</span><h2>Struktura scenariusza</h2></div><div className="outline-actions"><span className="muted small">{project.acts.length} aktów · {project.scenes.length} scen</span><div className="toolbar-group"><IconButton label="Cofnij zmianę" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></IconButton><IconButton label="Ponów zmianę" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></IconButton></div><button className="button" onClick={onAddAct}><Plus size={15} />Dodaj akt</button></div></div><div className="act-columns">{project.acts.map(act => {
    const scenes = project.scenes.filter(scene => scene.act === act);
    return <section className="outline-act" key={act}><div className="outline-act-heading"><h3>Akt {formatAct(act)}</h3><span>{scenes.length}</span><div className="outline-act-actions"><IconButton label={`Dodaj scenę do aktu ${act}`} onClick={() => onAdd(act)}><Plus size={17} /></IconButton><IconButton label={`Usuń akt ${formatAct(act)}`} onClick={() => requestRemoval(act)}><Trash2 size={15} /></IconButton></div></div>{scenes.map((scene, index) => <article className="outline-scene" key={scene.id}><button className="outline-scene-link" onClick={() => onSelect(scene.id)}><span className="eyebrow">SCENA {String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}</span><strong>{scene.title}<ArrowUpRight size={14} /></strong></button><p>{scene.synopsis || 'Brak opisu sceny.'}</p><div className="outline-scene-footer"><span className={`status-label ${scene.status}`}>{statusLabels[scene.status]}</span><IconButton label={`Przesuń scenę ${scene.title} w górę`} disabled={index === 0} onClick={() => move(scene, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`Przesuń scenę ${scene.title} w dół`} disabled={index === scenes.length - 1} onClick={() => move(scene, 1)}><ArrowDown size={14} /></IconButton></div></article>)}{scenes.length === 0 && <p className="empty-search">Brak scen w tym akcie.</p>}</section>;
  })}</div>
    {deletingAct !== undefined && <Modal title={`Usuń akt ${formatAct(deletingAct)}`} onClose={() => setDeletingAct(undefined)}>
      <div className="modal-body"><p>Usunąć akt {formatAct(deletingAct)} i wszystkie przypisane do niego sceny ({project.scenes.filter(scene => scene.act === deletingAct).length})? Operację możesz cofnąć w strukturze.</p></div>
      <div className="modal-actions"><button className="button" onClick={() => setDeletingAct(undefined)}>Anuluj</button><button className="button danger" onClick={() => removeAct(deletingAct)}>Usuń akt i sceny</button></div>
    </Modal>}
  </div>;
}
