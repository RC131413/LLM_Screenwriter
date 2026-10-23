import type { Character, Scene } from '../types';

export function checkScene(scene: Scene, characters: Character[]): string[] {
  const findings: string[] = [];
  if (!/^(WN\.|PL\.|INT\.|EXT\.)/.test(scene.heading)) findings.push('Nagłówek powinien zaczynać się od WN., PL., INT. lub EXT.');
  if (!scene.synopsis.trim()) findings.push('Uzupełnij cel sceny w opisie.');
  if (!scene.characterIds.length) findings.push('Scena nie ma przypisanych postaci.');
  const sceneText = scene.blocks.map(block => block.text).join('\n').normalize('NFKC').toLocaleUpperCase('pl').replace(/\s+/g, ' ');
  for (const character of characters.filter(item => scene.characterIds.includes(item.id))) {
    const name = character.name.normalize('NFKC').trim().toLocaleUpperCase('pl').replace(/\s+/g, ' ');
    if (!name) continue;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mention = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}(?=$|[^\\p{L}\\p{N}_])`, 'u');
    if (!mention.test(sceneText)) findings.push(`Postać ${character.name} jest zaznaczona, ale nie występuje w tekście sceny.`);
  }
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
