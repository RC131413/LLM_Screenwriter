import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditorSettings } from '../../src/hooks/useEditorSettings';

describe('personal editor display settings', () => {
  it('persists combined changes across remounts and keeps different accounts isolated', () => {
    const second = { zoom: 80, spellCheck: false, showBlockTypes: false };
    localStorage.setItem('agentdraft.editor.2', JSON.stringify(second));
    const { result, rerender, unmount } = renderHook(({ userId }) => useEditorSettings(userId), { initialProps: { userId: 1 } });
    act(() => {
      result.current.updateSettings({ zoom: 140 });
      result.current.updateSettings({ spellCheck: true, showBlockTypes: true });
    });
    expect(result.current.settings).toEqual({ zoom: 140, spellCheck: true, showBlockTypes: true });
    rerender({ userId: 2 });
    expect(result.current.settings).toEqual(second);
    expect(JSON.parse(localStorage.getItem('agentdraft.editor.2')!)).toEqual(second);
    act(() => result.current.updateSettings({ zoom: 90 }));
    unmount();
    const restored = renderHook(() => useEditorSettings(1));
    expect(restored.result.current.settings).toEqual({ zoom: 140, spellCheck: true, showBlockTypes: true });
    expect(JSON.parse(localStorage.getItem('agentdraft.editor.2')!).zoom).toBe(90);
  });

  it('loads the signed-in account after session hydration without overwriting stored preferences', () => {
    const saved = { zoom: 150, spellCheck: true, showBlockTypes: false };
    localStorage.setItem('agentdraft.editor.1', JSON.stringify(saved));
    const { result, rerender } = renderHook(({ userId }: { userId?: number }) => useEditorSettings(userId), { initialProps: { userId: undefined as number | undefined } });
    expect(result.current.settings.zoom).toBe(100);
    rerender({ userId: 1 });
    expect(result.current.settings).toEqual(saved);
    expect(JSON.parse(localStorage.getItem('agentdraft.editor.1')!)).toEqual(saved);
    rerender({ userId: undefined });
    expect(result.current.settings).toEqual({ zoom: 100, spellCheck: false, showBlockTypes: false });
  });

  it('recovers corrupt storage and bounds the zoom without trusting invalid field types', () => {
    localStorage.setItem('agentdraft.editor.1', '{invalid');
    localStorage.setItem('agentdraft.editor.2', JSON.stringify({ zoom: 999, spellCheck: 'true', showBlockTypes: true }));
    const { result, rerender } = renderHook(({ userId }) => useEditorSettings(userId), { initialProps: { userId: 1 } });
    expect(result.current.settings).toEqual({ zoom: 100, spellCheck: false, showBlockTypes: false });
    rerender({ userId: 2 });
    expect(result.current.settings).toEqual({ zoom: 200, spellCheck: false, showBlockTypes: true });
    act(() => result.current.updateSettings({ zoom: -10 }));
    expect(result.current.settings.zoom).toBe(50);
  });

  it('keeps display controls usable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    const { result } = renderHook(() => useEditorSettings(1));
    act(() => result.current.updateSettings({ zoom: 110, spellCheck: true }));
    expect(result.current.settings).toEqual({ zoom: 110, spellCheck: true, showBlockTypes: false });
  });
});
