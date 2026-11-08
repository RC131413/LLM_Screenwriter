import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SceneEditor } from '../../src/components/SceneEditor';
import { toProject } from '../../src/services/workspaceData';
import type { ScriptBlock } from '../../src/types';
import { workspaceFixture } from '../support/fixtures';

function mount(blocks: ScriptBlock[]) {
  const changes = vi.fn();
  function Harness() {
    const [scene, setScene] = useState({ ...toProject(workspaceFixture()).scenes[0], blocks });
    return <SceneEditor scene={scene} sceneNumber={1} zoom={100}
      onChange={next => { changes(next); setScene(next); }} onDelete={vi.fn()}
      undo={vi.fn()} redo={vi.fn()} canUndo={false} canRedo={false} />;
  }
  render(<Harness />);
  return changes;
}

const block = (id: string, text: string, type: ScriptBlock['type'] = 'action'): ScriptBlock => ({ id, text, type });
function cursor(label: string, offset: number) {
  const input = screen.getByLabelText<HTMLTextAreaElement>(label);
  act(() => { input.focus(); input.setSelectionRange(offset, offset); });
  return input;
}

describe('keyboard movement between screenplay blocks', () => {
  it('moves right at the end and left at the start without changing the scene', () => {
    const changes = mount([block('a', 'Akcja.'), block('b', 'ANNA', 'character'), block('c', 'Dialog.', 'dialogue')]);
    const action = cursor('Akcja 1', 6);
    fireEvent.keyDown(action, { key: 'ArrowRight' });
    const speaker = screen.getByLabelText<HTMLTextAreaElement>('Postać 2');
    expect(speaker).toHaveFocus(); expect(speaker.selectionStart).toBe(0);
    fireEvent.keyDown(speaker, { key: 'ArrowLeft' });
    expect(action).toHaveFocus(); expect(action.selectionStart).toBe(6);
    expect(changes).not.toHaveBeenCalled();
  });

  it('keeps selections, modifier shortcuts and ordinary editing native', () => {
    const changes = mount([block('a', 'Akcja.'), block('b', 'Drugi blok.')]);
    const input = cursor('Akcja 1', 6);
    expect(fireEvent.keyDown(input, { key: 'ArrowRight', ctrlKey: true })).toBe(true);
    expect(input).toHaveFocus();
    input.setSelectionRange(0, 6);
    expect(fireEvent.keyDown(input, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true })).toBe(true);
    input.setSelectionRange(3, 3);
    expect(fireEvent.keyDown(input, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Backspace' })).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });

  it('does not leave the scene at its first and last block', () => {
    mount([block('a', 'A'), block('b', 'B')]);
    const first = cursor('Akcja 1', 0);
    expect(fireEvent.keyDown(first, { key: 'ArrowLeft' })).toBe(true);
    expect(first).toHaveFocus();
    const last = cursor('Akcja 2', 1);
    expect(fireEvent.keyDown(last, { key: 'ArrowRight' })).toBe(true);
    expect(last).toHaveFocus();
  });

  it('deletes an empty block and places the cursor at the end of the previous one', () => {
    const changes = mount([block('a', 'Poprzedni.'), block('b', '', 'dialogue'), block('c', 'Następny.')]);
    const empty = cursor('Dialog 2', 0);
    fireEvent.keyDown(empty, { key: 'Backspace', repeat: true });
    const previous = screen.getByLabelText<HTMLTextAreaElement>('Akcja 1');
    expect(previous).toHaveFocus(); expect(previous.selectionStart).toBe(10);
    expect(screen.queryByLabelText('Dialog 2')).not.toBeInTheDocument();
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: [block('a', 'Poprzedni.'), block('c', 'Następny.')] }));
  });

  it('clears selected text first, then removes the empty block on the next Backspace', async () => {
    const changes = mount([block('a', 'Pierwszy.'), block('b', 'Do usunięcia.')]);
    const input = cursor('Akcja 2', 0);
    input.setSelectionRange(0, input.value.length);
    const user = userEvent.setup();
    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('Akcja 2')).toHaveValue('');
    await user.keyboard('{Backspace}');
    expect(screen.queryByLabelText('Akcja 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Akcja 1')).toHaveFocus();
    expect(changes.mock.lastCall?.[0].blocks).toEqual([block('a', 'Pierwszy.')]);
  });

  it('uses the next block when the first is empty and keeps a final writable block', async () => {
    mount([block('a', ''), block('b', '')]);
    const first = cursor('Akcja 1', 0);
    fireEvent.keyDown(first, { key: 'Backspace' });
    const remaining = screen.getByLabelText<HTMLTextAreaElement>('Akcja 1');
    expect(remaining.id).toBe('block-b'); expect(remaining).toHaveFocus();
    fireEvent.keyDown(remaining, { key: 'Backspace', repeat: true });
    expect(screen.getByLabelText('Akcja 1')).toBe(remaining);
    await userEvent.setup().keyboard('Dalej');
    expect(remaining).toHaveValue('Dalej');
  });

  it('does not treat whitespace or active composition as an empty block', () => {
    const changes = mount([block('a', 'Pierwszy.'), block('b', ' ')]);
    const input = cursor('Akcja 2', 1);
    expect(fireEvent.keyDown(input, { key: 'Backspace' })).toBe(true);
    fireEvent.change(input, { target: { value: '' } }); changes.mockClear();
    expect(fireEvent.keyDown(input, { key: 'Backspace', isComposing: true })).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });
});
