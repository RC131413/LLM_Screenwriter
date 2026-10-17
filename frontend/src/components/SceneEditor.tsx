import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { TextareaHTMLAttributes } from 'react';
import { blockLabels, formatAct, newId, statusLabels } from '../types';
import type { BlockType, Scene, ScriptBlock } from '../types';
import { IconButton } from './IconButton';

function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
    resize();
    const observer = new ResizeObserver(() => { if (element.offsetWidth !== lastWidth) { lastWidth = element.offsetWidth; resize(); } });
    let lastWidth = element.offsetWidth;
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} />;
}

interface Props {
  scene: Scene; sceneNumber: number; zoom: number; onChange: (scene: Scene) => void; onDelete: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
}
export function SceneEditor({ scene, sceneNumber, zoom, onChange, onDelete, undo, redo, canUndo, canRedo }: Props) {
  const [focusedId, setFocusedId] = useState<string>();
  const [newType, setNewType] = useState<BlockType>('action');
  const focused = scene.blocks.find(block => block.id === focusedId);
  function changeBlock(id: string, patch: Partial<ScriptBlock>) { onChange({ ...scene, blocks: scene.blocks.map(block => block.id === id ? { ...block, ...patch } : block) }); }
  function addBlock() {
    const block = { id: newId(), type: focused?.type ?? newType, text: '' };
    const index = focused ? scene.blocks.indexOf(focused) + 1 : scene.blocks.length;
    const next = [...scene.blocks]; next.splice(index, 0, block);
    onChange({ ...scene, blocks: next }); setFocusedId(block.id);
    requestAnimationFrame(() => document.getElementById(`block-${block.id}`)?.focus());
  }
  function moveBlock(direction: number) {
    if (!focused) return;
    const index = scene.blocks.indexOf(focused);
    if (index + direction < 0 || index + direction >= scene.blocks.length) return;
    const next = [...scene.blocks]; [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange({ ...scene, blocks: next });
  }
  return <>
    <div className="editor-toolbar">
      <div className="toolbar-group"><IconButton label="Cofnij zmianę" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></IconButton><IconButton label="Ponów zmianę" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></IconButton></div>
      <span className="toolbar-divider" />
      <select aria-label="Typ elementu" value={focused?.type ?? newType} onChange={event => { const type = event.target.value as BlockType; setNewType(type); if (focused) changeBlock(focused.id, { type }); }}>
        {Object.entries(blockLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <IconButton label="Dodaj element" onClick={addBlock}><Plus size={17} /></IconButton>
      <div className="toolbar-group block-tools"><IconButton label="Przesuń element w górę" disabled={!focused || scene.blocks[0]?.id === focusedId} onClick={() => moveBlock(-1)}><ArrowUp size={15} /></IconButton><IconButton label="Przesuń element w dół" disabled={!focused || scene.blocks.at(-1)?.id === focusedId} onClick={() => moveBlock(1)}><ArrowDown size={15} /></IconButton><IconButton label="Usuń element" disabled={!focused} onClick={() => { onChange({ ...scene, blocks: scene.blocks.filter(block => block.id !== focusedId) }); setFocusedId(undefined); }}><Trash2 size={15} /></IconButton></div>
      <div className="toolbar-end"><select aria-label="Status sceny" value={scene.status} onChange={event => onChange({ ...scene, status: event.target.value as Scene['status'] })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><IconButton label="Usuń scenę" onClick={onDelete}><Trash2 size={16} /></IconButton></div>
    </div>
    <div className="document-scroll">
      <div className="document-caption"><span>SCENA {String(sceneNumber).padStart(2, '0')}</span><div className="scene-title-field"><input aria-label="Tytuł sceny" title="Edytuj tytuł sceny" value={scene.title} onChange={event => onChange({ ...scene, title: event.target.value })} /><Pencil size={14} aria-hidden="true" /></div></div>
      <div className="document-sheet" style={{ zoom: zoom / 100 }}>
      <article className="script-page" aria-label="Edytor scenariusza">
        <div className="page-number">{sceneNumber}.</div>
        <AutoTextarea className="scene-heading" aria-label="Nagłówek sceny" spellCheck={false} value={scene.heading} onChange={event => onChange({ ...scene, heading: event.target.value })} onFocus={() => setFocusedId(undefined)} />
        {scene.blocks.map((block, index) => <div key={block.id} className={`script-block ${block.type} ${focusedId === block.id ? 'focused' : ''}`}>
          <AutoTextarea id={`block-${block.id}`} aria-label={`${blockLabels[block.type]} ${index + 1}`} spellCheck={false} value={block.text} placeholder={blockLabels[block.type]} onFocus={() => setFocusedId(block.id)} onChange={event => changeBlock(block.id, { text: event.target.value })} />
        </div>)}
        <button className="add-block" onClick={addBlock}><Plus size={14} />Dodaj element</button>
      </article>
      </div>
      <div className="document-bottom-label">{scene.title} · Akt {formatAct(scene.act)}</div>
    </div>
  </>;
}
