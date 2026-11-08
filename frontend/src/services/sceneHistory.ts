import type { Scene } from '../types';

export interface SceneTextEdit {
  field: 'title' | 'heading' | `block:${string}`;
  inputType: string;
  caret: number;
  selectionEnd: number;
  data: string | null;
}

const GROUP_PAUSE_MS = 1000;
const HISTORY_LIMIT = 50;
type TextChange = { kind: 'insert' | 'backspace' | 'delete'; before: number; after: number; startNew?: boolean };
type EditGroup = TextChange & { sceneId: string; field: SceneTextEdit['field']; time: number };

function textIn(scene: Scene, field: SceneTextEdit['field']): string | undefined {
  return field === 'title' || field === 'heading' ? scene[field]
    : scene.blocks.find(block => block.id === field.slice(6))?.text;
}

function textChange(previous: Scene, next: Scene, edit: SceneTextEdit): TextChange | undefined {
  const before = textIn(previous, edit.field);
  const after = textIn(next, edit.field);
  if (before === undefined || after === undefined || edit.caret !== edit.selectionEnd) return;
  const delta = after.length - before.length;
  const caret = edit.caret;
  if (edit.inputType === 'insertText' || edit.inputType === 'insertCompositionText') {
    const inserted = edit.data?.length ?? Math.max(0, delta);
    const removed = inserted - delta;
    const start = caret - inserted;
    // Replacing a selection starts a fresh typing group; the rest of that typing joins it.
    if (inserted > 0 && removed >= 0 && start >= 0
        && before.slice(0, start) + after.slice(start, caret) + before.slice(start + removed) === after) {
      return { kind: 'insert', before: start, after: caret, startNew: removed > 0 };
    }
  }
  if (delta >= 0 || !['deleteContentBackward', 'deleteContentForward'].includes(edit.inputType)) return;
  const removed = before.slice(caret, caret - delta);
  if ([...removed].length !== 1 || before.slice(0, caret) + before.slice(caret - delta) !== after) return;
  return { kind: edit.inputType === 'deleteContentBackward' ? 'backspace' : 'delete',
    before: edit.inputType === 'deleteContentBackward' ? caret - delta : caret, after: caret };
}

/** Scene snapshots grouped by adjacent text input, independent of autosave. */
export class SceneHistory {
  private past = new Map<string, Scene[]>();
  private future = new Map<string, Scene[]>();
  private group?: EditGroup;

  breakGroup() { this.group = undefined; }
  clear(sceneId?: string) {
    this.breakGroup();
    if (sceneId) { this.past.delete(sceneId); this.future.delete(sceneId); }
    else { this.past.clear(); this.future.clear(); }
  }
  canUndo(sceneId?: string) { return !!sceneId && !!this.past.get(sceneId)?.length; }
  canRedo(sceneId?: string) { return !!sceneId && !!this.future.get(sceneId)?.length; }

  record(previous: Scene, next: Scene, edit?: SceneTextEdit) {
    const change = edit && textChange(previous, next, edit);
    const time = Date.now();
    const group = this.group;
    const merge = change && !change.startNew && group && group.sceneId === previous.id && group.field === edit?.field
      && group.kind === change.kind && group.after === change.before
      && time >= group.time && time - group.time < GROUP_PAUSE_MS;
    if (!merge) this.past.set(previous.id, [...(this.past.get(previous.id) ?? []), previous].slice(-HISTORY_LIMIT));
    this.future.delete(previous.id);
    this.group = change && edit ? { ...change, sceneId: previous.id, field: edit.field, time } : undefined;
  }

  undo(current: Scene): Scene | undefined {
    this.breakGroup();
    const previous = this.past.get(current.id)?.pop();
    if (previous) this.future.set(current.id, [current, ...(this.future.get(current.id) ?? [])]);
    return previous;
  }
  redo(current: Scene): Scene | undefined {
    this.breakGroup();
    const next = this.future.get(current.id)?.shift();
    if (next) this.past.set(current.id, [...(this.past.get(current.id) ?? []), current].slice(-HISTORY_LIMIT));
    return next;
  }
}
