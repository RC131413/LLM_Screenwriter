import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../src/hooks/useWorkspace';
import type { SceneTextEdit } from '../../src/services/sceneHistory';
import { workspaceHttp } from '../support/workspaceHttp';

async function editor(twoScenes = false) {
  const http = workspaceHttp();
  if (twoScenes) http.workspace.scenes.push({ ...http.workspace.scenes[0], id: 21, scene_number: 2 });
  const { result } = renderHook(() => useWorkspace(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const scene = () => result.current.projects[0].scenes[0];
  const edit = (text: string, inputType = 'insertText', caret = text.length, data: string | null = null) => {
    const previous = scene();
    act(() => result.current.updateScene({ ...previous,
      blocks: [{ ...previous.blocks[0], text }, ...previous.blocks.slice(1)] },
    { field: `block:${previous.blocks[0].id}`, inputType, caret, selectionEnd: caret, data }));
  };
  const append = (text: string) => { for (const char of text) edit(scene().blocks[0].text + char, 'insertText', undefined, char); };
  const undo = () => act(() => result.current.undo('20'));
  const redo = () => act(() => result.current.redo('20'));
  return { result, scene, edit, append, undo, redo, http };
}

describe('grouped scene undo and redo with autosave', () => {
  it('restores a long run of Backspace in one undo, independently of the preceding typing', async () => {
    const { scene, append, edit, undo, redo, result, http } = await editor();
    const initial = scene().blocks[0].text;
    append(' Dopisany fragment.'.repeat(6));
    const written = scene().blocks[0].text;
    for (let length = written.length - 1; length >= 0; length--) edit(written.slice(0, length), 'deleteContentBackward');
    expect(scene().blocks[0].text).toBe('');
    undo(); expect(scene().blocks[0].text).toBe(written);
    undo(); expect(scene().blocks[0].text).toBe(initial);
    redo(); expect(scene().blocks[0].text).toBe(written);
    redo(); expect(scene().blocks[0].text).toBe('');
    undo();
    await act(async () => { await result.current.flush(); });
    expect(http.workspace.scenes[0].content_text).toBe(written);
    expect(http.workspace.scenes[0].ai_metadata.custom_ai).toEqual({ preserve: true });
  });

  it('keeps a text group through autosave but starts a new step after a pause', async () => {
    const { scene, append, undo, result, http } = await editor();
    vi.useFakeTimers();
    const initial = scene().blocks[0].text;
    append(' Anna');
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(http.workspace.scenes[0].content_text).toBe(initial + ' Anna');
    append(' czeka.');
    undo(); expect(scene().blocks[0].text).toBe(initial);
    append(' Pierwszy fragment.');
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    append(' Drugi fragment.');
    undo(); expect(scene().blocks[0].text).toBe(initial + ' Pierwszy fragment.');
    undo(); expect(scene().blocks[0].text).toBe(initial);
    expect(result.current.canRedo('20')).toBe(true);
  });

  it('separates cursor movement, field changes, and subsequent editing after undo', async () => {
    const { scene, append, edit, undo, redo, result } = await editor();
    const initial = scene().blocks[0].text;
    append(' dalej');
    // Insert elsewhere in the same field even if no keyboard boundary was reported.
    edit('!' + scene().blocks[0].text, 'insertText', 1, '!');
    undo(); expect(scene().blocks[0].text).toBe(initial + ' dalej');
    redo();
    act(() => result.current.breakHistoryGroup());
    edit('!?' + scene().blocks[0].text.slice(1), 'insertText', 2, '?');
    undo(); expect(scene().blocks[0].text).toBe('!' + initial + ' dalej');
    append(' nowy');
    expect(result.current.canRedo('20')).toBe(false);
    undo(); expect(scene().blocks[0].text).toBe('!' + initial + ' dalej');
    const title = scene().title;
    act(() => result.current.updateScene({ ...scene(), title: title + '!' },
      { field: 'title', inputType: 'insertText', caret: title.length + 1, selectionEnd: title.length + 1, data: '!' }));
    append(' tekst');
    undo(); expect(scene().title).toBe(title + '!');
    undo(); expect(scene().title).toBe(title);
  });

  it('keeps paste, selection replacement, block operations and forward deletion distinct', async () => {
    const { scene, append, edit, undo, result } = await editor();
    const initial = scene().blocks[0].text;
    append(' ABC');
    edit(scene().blocks[0].text + ' wklejony tekst', 'insertFromPaste');
    append(' XYZ');
    undo(); expect(scene().blocks[0].text).toBe(initial + ' ABC wklejony tekst');
    undo(); expect(scene().blocks[0].text).toBe(initial + ' ABC');
    edit('Nowy tekst', 'insertText', 10, 'Nowy tekst');
    append('!');
    undo(); expect(scene().blocks[0].text).toBe(initial + ' ABC');
    act(() => result.current.updateScene({ ...scene(), blocks: [...scene().blocks, { id: 'new', type: 'dialogue', text: '' }] }));
    undo(); expect(scene().blocks).toHaveLength(1);
    const beforeDelete = scene().blocks[0].text;
    for (let i = 1; i <= 5; i++) edit(beforeDelete.slice(i), 'deleteContentForward', 0);
    undo(); expect(scene().blocks[0].text).toBe(beforeDelete);
  });

  it('does not merge text changes from different scenes', async () => {
    const { result, scene, append, undo } = await editor(true);
    const first = scene();
    append(' A');
    // Another scene has an independent stack, including when block IDs overlap.
    const second = result.current.projects[0].scenes[1];
    const text = second.blocks[0].text + 'B';
    const edit: SceneTextEdit = { field: `block:${second.blocks[0].id}`, inputType: 'insertText', caret: text.length, selectionEnd: text.length, data: 'B' };
    act(() => result.current.updateScene({ ...second, blocks: [{ ...second.blocks[0], text }] }, edit));
    append(' C');
    undo(); expect(scene().blocks[0].text).toBe(first.blocks[0].text + ' A');
    undo(); expect(scene().blocks[0].text).toBe(first.blocks[0].text);
    act(() => result.current.undo('21'));
    expect(result.current.projects[0].scenes[1].blocks[0].text).toBe(second.blocks[0].text);
    expect(result.current.canRedo('21')).toBe(true);
  });
});
