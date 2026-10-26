import { ApiError } from './api';
import type { ApiCharacter, ApiScene, ApiWorkspace, JsonObject, Page, PaginationParams, UpdateSceneInput } from './api';
import type { BlockType, Character, Project, Scene, ScriptBlock } from '../types';
import { formatSceneHeading, splitSceneHeading } from './sceneHeading';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sesja wygasła. Zaloguj się ponownie.';
    if (error.status === 403) return 'Nie udało się potwierdzić sesji. Odśwież stronę i spróbuj ponownie.';
    if (error.status === 429) return 'Zbyt wiele zapytań. Odczekaj chwilę i spróbuj ponownie.';
    const fields = Object.entries(error.fieldErrors).map(([field, messages]) => `${field}: ${messages.join(' ')}`);
    return fields.length ? fields.join(' ') : error.message;
  }
  return error instanceof TypeError ? 'Nie można połączyć się z API. Sprawdź połączenie i uruchomienie Django.' :
    error instanceof Error ? error.message : 'Nie udało się wykonać operacji.';
}

export async function allPages<T>(load: (params: PaginationParams) => Promise<Page<T>>, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  while (true) {
    signal?.throwIfAborted();
    const page = await load({ limit: 100, offset: items.length });
    items.push(...page.items);
    if (!page.items.length || items.length >= page.count) return items;
  }
}

export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

export function sceneBlocks(metadata: JsonObject, content: string, sceneId: string): ScriptBlock[] {
  const types: BlockType[] = ['action', 'character', 'dialogue', 'parenthetical', 'transition'];
  if (Array.isArray(metadata.blocks)) {
    const blocks = metadata.blocks.filter((value): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value));
    if (blocks.length === metadata.blocks.length && blocks.every(block => typeof block.id === 'string' &&
      typeof block.text === 'string' && types.includes(block.type as BlockType)) && new Set(blocks.map(block => block.id)).size === blocks.length) {
      return blocks.map(block => ({ id: String(block.id), type: block.type as BlockType, text: String(block.text) }));
    }
  }
  return content ? [{ id: `content-${sceneId}`, type: 'action', text: content }] : [];
}

export function toScene(scene: ApiScene, actNumber: number): Scene {
  const metadata = scene.editor_metadata;
  const status = text(metadata.status);
  return {
    id: String(scene.id), scene_number: scene.scene_number, title: scene.title,
    heading: formatSceneHeading(scene.location_heading, scene.time_of_day), time_of_day: scene.time_of_day, act: actNumber,
    status: status === 'review' || status === 'ready' ? status : 'draft',
    synopsis: text(scene.ai_metadata.scene_goal), notes: text(scene.ai_metadata.notes),
    characterIds: scene.cast_members.map(member => String(member.character_id)),
    blocks: sceneBlocks(metadata, scene.content_text, String(scene.id)),
    ai_metadata: scene.ai_metadata, editor_metadata: metadata,
  };
}

export function toCharacter(character: ApiCharacter): Character {
  return {
    id: String(character.id), name: character.name, age: character.age === null ? '' : String(character.age),
    role: character.role, goal: character.goals, flaw: character.psychological_profile,
    voice: text(character.voice_profile.description) || text(character.voice_profile.tone),
    appearance: character.appearance, backstory: character.backstory, voice_profile: character.voice_profile,
  };
}

export function toProject(workspace: ApiWorkspace): Project {
  const { project, acts, characters, scenes } = workspace;
  const orders = new Map(acts.map((act, index) => [act.id, index]));
  return {
    id: String(project.id), title: project.title, genre: project.genre, logline: project.logline,
    synopsis: project.synopsis, target_audience: project.target_audience, metadata: project.metadata,
    acts: acts.map(act => ({ id: String(act.id), act_number: act.act_number, title: act.title, summary: act.summary })),
    characters: characters.map(toCharacter),
    scenes: [...scenes].sort((a, b) => (orders.get(a.act_id) ?? 0) - (orders.get(b.act_id) ?? 0) || a.sort_order - b.sort_order || a.scene_number - b.scene_number)
      .map(scene => toScene(scene, acts.find(act => act.id === scene.act_id)!.act_number)),
  };
}

export function scenePayload(scene: Scene): UpdateSceneInput {
  return {
    title: scene.title, ...splitSceneHeading(scene.heading, scene.time_of_day),
    content_text: scene.blocks.map(block => block.text).join('\n\n'),
    ai_metadata: { ...scene.ai_metadata, scene_goal: scene.synopsis, notes: scene.notes },
    editor_metadata: { ...scene.editor_metadata, status: scene.status, blocks: scene.blocks.map(block => ({ ...block })) },
  };
}
