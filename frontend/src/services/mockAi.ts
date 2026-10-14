import { newId } from '../types';
import type { Character, Scene, SceneVariant, ScriptBlock } from '../types';

export const agentRoles = [
  { name: 'Archiwista', task: 'Kontekst projektu i postaci' },
  { name: 'Reżyser', task: 'Cel i przebieg sceny' },
  { name: 'Scenarzysta', task: 'Dialogi i didaskalia' },
  { name: 'Krytyk', task: 'Spójność narracji' },
];

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

// This adapter is the boundary to replace with Django API calls later.
export async function generateVariants(
  scene: Scene, characters: Character[], brief: string, count: number,
  signal: AbortSignal, onAgent: (index: number) => void,
): Promise<SceneVariant[]> {
  for (let index = 0; index < agentRoles.length; index++) {
    onAgent(index);
    await wait(450, signal);
  }
  const cast = characters.filter(character => scene.characterIds.includes(character.id));
  const speaker = cast[0]?.name ?? 'POSTAĆ';
  const respondent = cast[1]?.name;
  const choices = [
    { title: 'Podtekst', description: 'Napięcie budowane przez pauzy i niedopowiedzenia.', action: 'Zapada cisza. Spojrzenie zatrzymuje się na drzwiach. Ktoś powinien już tu być.', line: 'Jeszcze możemy stąd odejść.', reply: 'A jutro? Znowu udamy, że nic się nie stało?' },
    { title: 'Konfrontacja', description: 'Bezpośrednia rozmowa i wyraźny konflikt.', action: 'Krzesło szura po podłodze. Tym razem nikt nie odwraca wzroku.', line: 'Dość. Chcę usłyszeć prawdę.', reply: 'Prawdę czy odpowiedź, z którą potrafisz żyć?' },
    { title: 'Cisza', description: 'Oszczędny dialog. Ciężar sceny przejmują gesty.', action: 'Dłoń sięga do kieszeni i zatrzymuje się w połowie ruchu. Przez chwilę nic się nie zmienia.', line: 'Zostań.', reply: 'Tylko do rana.' },
  ];
  return choices.slice(0, count).map(choice => {
    const additions: ScriptBlock[] = [
      { id: newId(), type: 'action', text: choice.action },
      { id: newId(), type: 'character', text: speaker },
      { id: newId(), type: 'dialogue', text: choice.line },
    ];
    if (respondent) additions.push(
      { id: newId(), type: 'character', text: respondent },
      { id: newId(), type: 'dialogue', text: choice.reply },
    );
    return { id: newId(), title: choice.title, description: `${choice.description}${brief.trim() ? ` Brief: ${brief.trim()}` : ''}`, blocks: [...structuredClone(scene.blocks), ...additions] };
  });
}

export function checkScene(scene: Scene, characters: Character[]): string[] {
  const findings: string[] = [];
  if (!/^(WN\.|PL\.|INT\.|EXT\.)/.test(scene.heading)) findings.push('Nagłówek powinien zaczynać się od WN., PL., INT. lub EXT.');
  if (!scene.synopsis.trim()) findings.push('Uzupełnij cel sceny w opisie.');
  if (!scene.characterIds.length) findings.push('Scena nie ma przypisanych postaci.');
  let speaker = '';
  for (const block of scene.blocks) {
    if (!block.text.trim()) findings.push('W scenie znajduje się pusty element.');
    if (block.type === 'action' || block.type === 'transition') speaker = '';
    if (block.type === 'character') {
      speaker = block.text.trim().toLocaleUpperCase('pl');
      const character = characters.find(item => item.name.toLocaleUpperCase('pl') === speaker);
      if (!character) findings.push(`Postać „${block.text}” nie ma karty w projekcie.`);
      else if (!scene.characterIds.includes(character.id)) findings.push(`Przypisz postać ${character.name} do sceny.`);
    }
    if (block.type === 'dialogue' && !speaker) findings.push('Dialog nie ma poprzedzającego go imienia postaci.');
  }
  return [...new Set(findings)];
}
