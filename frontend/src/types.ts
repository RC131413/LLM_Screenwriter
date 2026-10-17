export type BlockType = 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition';
export type SceneStatus = 'draft' | 'review' | 'ready';
export type View = 'script' | 'outline' | 'characters';

export interface ScriptBlock { id: string; type: BlockType; text: string }
export interface Scene {
  id: string;
  title: string;
  heading: string;
  act: number;
  status: SceneStatus;
  synopsis: string;
  characterIds: string[];
  blocks: ScriptBlock[];
  notes: string;
}
export interface Character {
  id: string;
  name: string;
  age: string;
  role: string;
  goal: string;
  flaw: string;
  voice: string;
  appearance: string;
  backstory: string;
}
export interface Act {
  act_number: number;
  title: string;
  summary: string;
}
export interface ProjectMetadata {
  [key: string]: unknown;
  is_favorite?: boolean;
  archived_at?: string | null;
  deleted_at?: string | null;
  last_opened_at?: string | null;
}
export interface Project {
  id: string;
  title: string;
  genre: string;
  logline: string;
  synopsis: string;
  target_audience: string;
  acts: Act[];
  scenes: Scene[];
  characters: Character[];
  metadata?: ProjectMetadata;
}
export type DashboardCollection = 'all' | 'recent' | 'favorites' | 'archive' | 'trash';
export type SettingsTab = 'account' | 'ai' | 'statistics';

export interface UserProfile {
  display_name: string;
  email: string;
  avatar_url: string | null;
  preferred_language: 'pl';
}

export interface UserPreferences {
  writing_style_preferences: {
    stage_directions_style: 'concise_technical' | 'literary_descriptive';
    dialogue_tone: string;
    parentheticals: 'sparingly' | 'ignore';
  };
  llm_preferences: {
    model_name: 'Bielik 11B (Lokalny)';
    temperature: number;
    max_tokens: number;
  };
}
export interface SceneVariant { id: string; title: string; description: string; blocks: ScriptBlock[] }

export const blockLabels: Record<BlockType, string> = {
  action: 'Akcja', character: 'Postać', dialogue: 'Dialog',
  parenthetical: 'Didaskalia', transition: 'Przejście',
};
export const statusLabels: Record<SceneStatus, string> = {
  draft: 'Szkic', review: 'Do sprawdzenia', ready: 'Gotowa',
};
export const newId = () => crypto.randomUUID();

export const screenplayModel = 'Bielik 11B';

export const createAct = (act_number: number): Act => ({ act_number, title: '', summary: '' });

export function formatAct(number: number): string {
  if (number > 3999) return String(number);
  const numerals: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let label = '';
  for (const [value, numeral] of numerals) {
    while (number >= value) { label += numeral; number -= value; }
  }
  return label;
}
