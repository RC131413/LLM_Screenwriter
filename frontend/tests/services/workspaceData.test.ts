import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/services/api';
import type { JsonObject } from '../../src/services/api';
import { allPages, errorMessage, sceneBlocks, scenePayload, toCharacter, toProject, toScene } from '../../src/services/workspaceData';
import { characterFixture, workspaceFixture } from '../support/fixtures';

describe('API DTOs and editor persistence', () => {
  it('maps server IDs, null age, goals, cast and nested metadata without losing data', () => {
    const workspace = workspaceFixture();
    const project = toProject(workspace);
    expect(project).toMatchObject({ id: '1', synopsis: 'Historia listu.', target_audience: 'Dorośli' });
    expect(project.scenes[0]).toMatchObject({ id: '20', act: 1, characterIds: ['30'], synopsis: 'Odkryć nadawcę' });
    expect(project.characters[0]).toMatchObject({ id: '30', age: '', goal: 'Odnaleźć list', voice: 'Spokojny' });
    const scene = { ...project.scenes[0], notes: 'Nowa notatka', blocks: [
      { id: 'a', type: 'character' as const, text: 'ANNA' },
      { id: 'b', type: 'dialogue' as const, text: 'Otwórz drzwi.' },
    ] };
    const payload = scenePayload(scene);
    expect(payload.content_text).toBe('ANNA\n\nOtwórz drzwi.');
    expect(payload.ai_metadata).toEqual({ scene_goal: 'Odkryć nadawcę', notes: 'Nowa notatka', custom_ai: { preserve: true } });
    expect(payload.editor_metadata).toMatchObject({ zoom: 120, status: 'draft', blocks: scene.blocks });
    expect(workspace.scenes[0].ai_metadata.notes).toBe('Cisza');
  });

  it('orders scenes by act order and per-act sort order, without sorting the API array in place', () => {
    const workspace = workspaceFixture();
    workspace.scenes = [
      { ...workspace.scenes[0], id: 21, act_id: 11, scene_number: 2 },
      { ...workspace.scenes[0], id: 22, sort_order: 5, scene_number: 3 },
      workspace.scenes[0],
    ];
    expect(toProject(workspace).scenes.map(scene => scene.id)).toEqual(['20', '22', '21']);
    expect(workspace.scenes.map(scene => scene.id)).toEqual([21, 22, 20]);
  });

  it.each<JsonObject>([
    { blocks: [{ id: 'same', type: 'action', text: 'A' }, { id: 'same', type: 'action', text: 'B' }] },
    { blocks: [{ id: 'a', type: 'unknown', text: 'A' }] },
    { blocks: [null] },
    {},
  ])('uses persisted plain text when editor blocks are invalid: %j', metadata => {
    expect(sceneBlocks(metadata, 'Zapisany tekst', '20')).toEqual([{ id: 'content-20', type: 'action', text: 'Zapisany tekst' }]);
  });

  it('handles an empty scene, invalid saved status and numeric character age', () => {
    expect(sceneBlocks({}, '', '20')).toEqual([]);
    expect(toScene({ ...workspaceFixture().scenes[0], editor_metadata: { status: 'unknown' } }, 2).status).toBe('draft');
    expect(toCharacter({ ...characterFixture(), age: 42, voice_profile: { description: 'Szept', tone: 'Cichy' } }))
      .toMatchObject({ age: '42', voice: 'Szept' });
  });
});

describe('pagination and errors', () => {
  it('loads all pages using the actual number of received rows', async () => {
    const load = vi.fn().mockResolvedValueOnce({ items: [1, 2], count: 3 }).mockResolvedValueOnce({ items: [3], count: 3 });
    expect(await allPages(load)).toEqual([1, 2, 3]);
    expect(load.mock.calls).toEqual([[{ limit: 100, offset: 0 }], [{ limit: 100, offset: 2 }]]);
  });
  it('stops on an empty page even if the total changes', async () => {
    const load = vi.fn().mockResolvedValue({ items: [], count: 100 });
    expect(await allPages(load)).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('does not fetch another page after cancellation', async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => { controller.abort(); return { items: [1], count: 2 }; });
    await expect(allPages(load, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('propagates a failed later page instead of returning incomplete data', async () => {
    const failure = new ApiError(503, { detail: 'Unavailable' });
    const load = vi.fn().mockResolvedValueOnce({ items: [1], count: 2 }).mockRejectedValueOnce(failure);
    await expect(allPages(load)).rejects.toBe(failure);
  });
  it.each([
    [new ApiError(401, {}), 'Sesja wygasła'],
    [new ApiError(403, {}), 'Nie udało się potwierdzić sesji'],
    [new ApiError(429, {}), 'Zbyt wiele zapytań'],
    [new ApiError(422, { fields: { title: ['Za krótki'] } }), 'title: Za krótki'],
    [new TypeError('Failed to fetch'), 'Nie można połączyć się z API'],
  ])('explains API errors to the user', (failure, expected) => {
    expect(errorMessage(failure)).toContain(expected);
  });
});
