import type { ApiCharacter, ApiPreferences, ApiPrompt, ApiSceneVariant, ApiUser, ApiWorkspace } from '../../src/services/api';

// Test-only DTOs: runtime components never import this module.
export const timestamp = '2026-10-20T12:00:00Z';
const timestamps = { created_at: timestamp, updated_at: timestamp };

export function preferencesFixture(): ApiPreferences {
  return {
    writing_style_preferences: {
      stage_directions_style: 'concise_technical', dialogue_tone: 'Neutralny, realistyczny', parentheticals: 'sparingly',
    },
    llm_preferences: { model_name: 'Bielik 11B (Lokalny)', temperature: 0.7, max_tokens: 2048 },
  };
}

export function userFixture(id = 1): ApiUser {
  return {
    id, username: `writer${id}`, email: `writer${id}@example.com`, ...timestamps,
    profile: {
      id, user_id: id, display_name: 'Anna', avatar_url: '', preferred_language: 'pl',
      writing_style_preferences: {}, llm_preferences: {}, ...timestamps,
    },
  };
}

export function characterFixture(id = 30): ApiCharacter {
  return {
    id, project_id: 1, name: id === 30 ? 'ANNA' : 'PIOTR', role: 'Protagonista', age: null,
    psychological_profile: 'Nieufność', appearance: 'Szary płaszcz', backstory: 'Była nauczycielka',
    goals: 'Odnaleźć list', fears: '', voice_profile: { tone: 'Spokojny', custom: true }, memory_metadata: {}, ...timestamps,
  };
}

export function workspaceFixture(): ApiWorkspace {
  return {
    project: {
      id: 1, user_id: 1, title: 'Nocny pociąg', logline: 'Pasażerka odnajduje list.', synopsis: 'Historia listu.',
      genre: 'Dramat', target_audience: 'Dorośli', screenplay_format: 'fountain', status: 'draft',
      metadata: { custom: { preserve: true } }, ...timestamps,
    },
    acts: [
      { id: 10, project_id: 1, act_number: 1, title: 'Odjazd', summary: 'Pociąg rusza.', sort_order: 0, metadata: {}, ...timestamps },
      { id: 11, project_id: 1, act_number: 2, title: 'Podróż', summary: '', sort_order: 1, metadata: {}, ...timestamps },
    ],
    characters: [characterFixture(), characterFixture(31)],
    scenes: [{
      id: 20, project_id: 1, act_id: 10, scene_number: 1, sort_order: 0,
      title: 'List', location_heading: 'INT. POCIĄG - NOC', time_of_day: 'night', content_text: 'ANNA czyta list.',
      ai_metadata: { scene_goal: 'Odkryć nadawcę', notes: 'Cisza', custom_ai: { preserve: true } },
      editor_metadata: { status: 'draft', zoom: 120, blocks: [{ id: 'block-1', type: 'action', text: 'ANNA czyta list.' }] },
      cast_members: [{ id: 40, scene_id: 20, character_id: 30, presence_type: 'on_screen', notes: 'Przy oknie', created_at: timestamp }],
      ...timestamps,
    }],
  };
}

export function promptFixture(sceneId = 20, id = 50): ApiPrompt {
  return {
    id, scene_id: sceneId, user_prompt: `Prompt dla sceny ${sceneId}`, system_prompt: '', context_snapshot: {},
    model_name: 'Bielik 11B (Lokalny)', generation_parameters: {}, created_at: timestamp,
  };
}

export function variantFixture(sceneId = 20, id = 70): ApiSceneVariant {
  return {
    id, run_id: 60, scene_id: sceneId, variant_number: 1, title: 'Wariant Bielika',
    generated_full_text: 'ANNA\n\nZnalazłam list.', critic_score: null, critic_feedback: '', critic_metadata: {},
    is_selected: false, created_at: timestamp,
  };
}
