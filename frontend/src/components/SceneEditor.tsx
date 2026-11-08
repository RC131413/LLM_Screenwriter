import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent, TextareaHTMLAttributes } from 'react';
import { blockLabels, formatAct, newId, statusLabels } from '../types';
import type { BlockType, Scene, ScriptBlock } from '../types';
import { IconButton } from './IconButton';
import { focusCaret, pointerCaretAffinity, verticalCaretMove } from './caretNavigation';
import type { CaretAffinity } from './caretNavigation';
import type { SceneTextEdit } from '../services/sceneHistory';

function textEdit(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, field: SceneTextEdit['field']): SceneTextEdit {
  const input = event.nativeEvent as InputEvent;
  return { field, inputType: input.inputType ?? '', data: input.data ?? null,
    caret: event.currentTarget.selectionStart ?? 0, selectionEnd: event.currentTarget.selectionEnd ?? 0 };
}

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
  scene: Scene; sceneNumber: number; zoom: number; onChange: (scene: Scene, edit?: SceneTextEdit) => void; onDelete: () => void;
  onHistoryBoundary?: () => void;
  spellCheck?: boolean; showBlockTypes?: boolean;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
}
export function SceneEditor({ scene, sceneNumber, zoom, onChange, onDelete, undo, redo, canUndo, canRedo, onHistoryBoundary, spellCheck = false, showBlockTypes = false }: Props) {
  const [focusedId, setFocusedId] = useState<string>();
  const [newType, setNewType] = useState<BlockType>('action');
  const page = useRef<HTMLElement>(null);
  const preferredX = useRef<number | undefined>(undefined);
  const affinity = useRef<CaretAffinity>('forward');
  useLayoutEffect(() => { preferredX.current = undefined; affinity.current = 'forward'; }, [scene.id, zoom]);
  useLayoutEffect(() => { onHistoryBoundary?.(); return () => onHistoryBoundary?.(); }, [scene.id, onHistoryBoundary]);
  const focused = scene.blocks.find(block => block.id === focusedId);
  function changeBlock(id: string, patch: Partial<ScriptBlock>, edit?: SceneTextEdit) { onChange({ ...scene, blocks: scene.blocks.map(block => block.id === id ? { ...block, ...patch } : block) }, edit); }
  const handleEditorKey = useCallback((event: KeyboardEvent<HTMLDivElement> | globalThis.KeyboardEvent) => {
    if (('nativeEvent' in event ? event.nativeEvent : event).isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault(); event.stopPropagation(); onHistoryBoundary?.();
      if (key === 'y' || event.shiftKey) { if (canRedo) redo(); }
      else if (canUndo) undo();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'].includes(event.key)
        || ((event.ctrlKey || event.metaKey) && !['Control', 'Meta', 'Shift', 'Alt'].includes(event.key))) onHistoryBoundary?.();
  }, [canRedo, canUndo, onHistoryBoundary, redo, undo]);
  useEffect(() => {
    // A toolbar button that becomes disabled can return focus to the document body.
    // Keep shortcuts working there without taking native undo away from other forms.
    const unfocusedKey = (event: globalThis.KeyboardEvent) => { if (event.target === document.body) handleEditorKey(event); };
    document.addEventListener('keydown', unfocusedKey);
    return () => document.removeEventListener('keydown', unfocusedKey);
  }, [handleEditorKey]);
  function addBlock() {
    preferredX.current = undefined;
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
  function handleBlockKey(event: KeyboardEvent<HTMLTextAreaElement>, index: number) {
    const input = event.currentTarget;
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!vertical) {
      preferredX.current = undefined;
      affinity.current = event.key === 'End' || event.key === 'ArrowLeft' ? 'backward' : 'forward';
    }
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || input.selectionStart !== input.selectionEnd) {
      preferredX.current = undefined;
      affinity.current = 'forward';
      return;
    }
    const fields = page.current?.querySelectorAll<HTMLTextAreaElement>('.script-block textarea');
    if (!fields) return;
    if (event.key === 'Backspace' && input.value.length === 0) {
      event.preventDefault();
      // Keep one writable paragraph when this is the only remaining block.
      if (scene.blocks.length === 1) return;
      const previous = fields[index - 1];
      const target = previous ?? fields[index + 1];
      onChange({ ...scene, blocks: scene.blocks.filter((_, position) => position !== index) });
      if (target) focusCaret(target, previous ? target.value.length : 0);
      return;
    }
    if (vertical) {
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const target = fields[index + direction];
      const move = verticalCaretMove(input, target, direction, preferredX.current, affinity.current);
      if (move) preferredX.current = move.preferredX;
      if (target && move?.offset != null) { event.preventDefault(); focusCaret(target, move.offset); }
      return;
    }
    const previous = event.key === 'ArrowLeft' && input.selectionStart === 0;
    const next = event.key === 'ArrowRight' && input.selectionStart === input.value.length;
    if (previous || next) {
      const target = fields[index + (previous ? -1 : 1)];
      if (target) { event.preventDefault(); focusCaret(target, previous ? target.value.length : 0); }
    }
  }
  return <>
    <div className="editor-toolbar" onKeyDownCapture={handleEditorKey}>
      <div className="toolbar-group"><IconButton label="Cofnij zmianę" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></IconButton><IconButton label="Ponów zmianę" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></IconButton></div>
      <span className="toolbar-divider" />
      <select aria-label="Typ elementu" value={focused?.type ?? newType} onChange={event => { const type = event.target.value as BlockType; setNewType(type); if (focused) changeBlock(focused.id, { type }); }}>
        {Object.entries(blockLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <IconButton label="Dodaj element" onClick={addBlock}><Plus size={17} /></IconButton>
      <div className="toolbar-group block-tools"><IconButton label="Przesuń element w górę" disabled={!focused || scene.blocks[0]?.id === focusedId} onClick={() => moveBlock(-1)}><ArrowUp size={15} /></IconButton><IconButton label="Przesuń element w dół" disabled={!focused || scene.blocks.at(-1)?.id === focusedId} onClick={() => moveBlock(1)}><ArrowDown size={15} /></IconButton><IconButton label="Usuń element" disabled={!focused} onClick={() => { onChange({ ...scene, blocks: scene.blocks.filter(block => block.id !== focusedId) }); setFocusedId(undefined); }}><Trash2 size={15} /></IconButton></div>
      <div className="toolbar-end"><select aria-label="Status sceny" value={scene.status} onChange={event => onChange({ ...scene, status: event.target.value as Scene['status'] })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><IconButton label="Usuń scenę" onClick={onDelete}><Trash2 size={16} /></IconButton></div>
    </div>
    <div className="document-scroll" lang="pl" onKeyDownCapture={handleEditorKey} onPointerDownCapture={onHistoryBoundary}
      onFocusCapture={onHistoryBoundary} onBlurCapture={onHistoryBoundary} onPasteCapture={onHistoryBoundary} onCutCapture={onHistoryBoundary}>
      <div className="document-caption"><span>SCENA {String(sceneNumber).padStart(2, '0')}</span><div className="scene-title-field"><input aria-label="Tytuł sceny" title="Edytuj tytuł sceny" spellCheck={spellCheck} maxLength={255} value={scene.title} onChange={event => onChange({ ...scene, title: event.target.value }, textEdit(event, 'title'))} /><Pencil size={14} aria-hidden="true" /></div></div>
      <div className="document-sheet" style={{ zoom: zoom / 100 }}>
      <article ref={page} className="script-page" aria-label="Edytor scenariusza">
        <div className="page-number">{sceneNumber}.</div>
        <div className="scene-heading-field">
          <label htmlFor={`scene-heading-${scene.id}`}>Nagłówek sceny<Pencil size={12} aria-hidden="true" /></label>
          <AutoTextarea id={`scene-heading-${scene.id}`} className="scene-heading" aria-describedby={`scene-heading-help-${scene.id}`} placeholder="Np. WN. DOM – RANO" maxLength={255} spellCheck={false} value={scene.heading} onChange={event => onChange({ ...scene, heading: event.target.value }, textEdit(event, 'heading'))} onFocus={() => { preferredX.current = undefined; setFocusedId(undefined); }} />
          <p id={`scene-heading-help-${scene.id}`}>Po myślniku wpisz porę dnia, np. RANO, DZIEŃ lub NOC.</p>
        </div>
        {scene.blocks.map((block, index) => <div key={block.id} className={`script-block ${block.type} ${focusedId === block.id ? 'focused' : ''}`}>
          {showBlockTypes && <span className="script-block-type" aria-hidden="true">{blockLabels[block.type]}</span>}
          <AutoTextarea id={`block-${block.id}`} aria-label={`${blockLabels[block.type]} ${index + 1}`} spellCheck={spellCheck && block.type !== 'character' && block.type !== 'transition'} value={block.text} placeholder={blockLabels[block.type]} onFocus={() => setFocusedId(block.id)} onPointerDown={() => { preferredX.current = undefined; affinity.current = 'forward'; }} onPointerUp={event => { affinity.current = pointerCaretAffinity(event.currentTarget, event.clientY); }} onKeyDown={event => handleBlockKey(event, index)} onChange={event => { preferredX.current = undefined; affinity.current = 'forward'; changeBlock(block.id, { text: event.target.value }, textEdit(event, `block:${block.id}`)); }} />
        </div>)}
        <button className="add-block" onClick={addBlock}><Plus size={14} />Dodaj element</button>
      </article>
      </div>
      <div className="document-bottom-label">{scene.title} · Akt {formatAct(scene.act)}</div>
    </div>
  </>;
}
