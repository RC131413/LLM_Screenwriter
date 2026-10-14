import type { Project } from '../types';

export function exportProject(project: Project, format: 'fountain' | 'json') {
  const content = format === 'json' ? JSON.stringify(project, null, 2) : [
    `Title: ${project.title}`, 'Credit: Scenariusz', '',
    ...project.scenes.flatMap(scene => [
      `.${scene.heading}`, '',
      ...scene.blocks.flatMap(block => [
        block.type === 'character' ? `@${block.text.toLocaleUpperCase('pl')}` :
        block.type === 'transition' ? `>${block.text}` :
        block.type === 'parenthetical' ? `(${block.text.replace(/^\(|\)$/g, '')})` : block.text,
        ...(block.type === 'character' || block.type === 'parenthetical' ? [] : ['']),
      ]), '',
    ]),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
