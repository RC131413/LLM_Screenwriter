import { useEffect, useState } from 'react';
import type { Project, Scene } from '../types';
import { formatAct } from '../types';

interface Props {
  project: Project;
  scene: Scene | undefined;
  onSelect: (id: string) => void;
  onChange: (scene: Scene) => void;
}

export function SceneContext({ project, scene, onSelect, onChange }: Props) {
  const [actNumber, setActNumber] = useState(scene?.act ?? project.acts[0]?.act_number);
  useEffect(() => { if (scene) setActNumber(scene.act); }, [scene?.id, scene?.act]);
  const currentAct = project.acts.find(act => act.act_number === actNumber) ?? project.acts[0];
  const scenes = project.scenes.filter(item => item.act === currentAct?.act_number);
  const selectedScene = scenes.find(item => item.id === scene?.id);
  return <>
    <section className="panel-section">
      <label className="field-label" htmlFor="scene-act">Akt</label>
      <select id="scene-act" className="field-input" value={currentAct?.act_number ?? ''} disabled={!project.acts.length} onChange={event => {
        const number = Number(event.target.value); setActNumber(number);
        const firstScene = project.scenes.find(item => item.act === number);
        if (firstScene) onSelect(firstScene.id);
      }}>{!project.acts.length && <option value="">Brak aktów</option>}{project.acts.map(act => <option value={act.act_number} key={act.act_number}>Akt {formatAct(act.act_number)}{act.title && ` · ${act.title}`}</option>)}</select>
      <label className="field-label spaced" htmlFor="context-scene">Scena</label>
      <select id="context-scene" className="field-input" value={selectedScene?.id ?? ''} disabled={!scenes.length} onChange={event => onSelect(event.target.value)}>
        {!selectedScene && <option value="">{scenes.length ? 'Wybierz scenę' : 'Brak scen w tym akcie'}</option>}
        {scenes.map(item => <option value={item.id} key={item.id}>{String(item.scene_number).padStart(2, '0')} · {item.title || 'Bez tytułu'}</option>)}
      </select>
      {selectedScene ? <><label className="field-label spaced" htmlFor="scene-synopsis">Cel sceny</label><textarea id="scene-synopsis" className="field-textarea" rows={4} value={selectedScene.synopsis} onChange={event => onChange({ ...selectedScene, synopsis: event.target.value })} /></> : <p className="context-empty">{scenes.length ? 'Wybierz scenę.' : 'Brak scen w tym akcie.'}</p>}
    </section>
    <section className="panel-section">
      <details className="metadata-disclosure">
        <summary>Projekt: {project.title}</summary>
        <dl className="metadata-list"><dt>Grupa docelowa</dt><dd>{project.target_audience || 'Nie określono'}</dd><dt>Streszczenie</dt><dd>{project.synopsis || 'Nie określono'}</dd></dl>
      </details>
      {currentAct && <details className="metadata-disclosure">
        <summary>Akt {formatAct(currentAct.act_number)}{currentAct.title && ` · ${currentAct.title}`}</summary>
        <dl className="metadata-list"><dt>Streszczenie wydarzeń w akcie</dt><dd>{currentAct.summary || 'Nie określono'}</dd></dl>
      </details>}
    </section>
    {selectedScene && <>
      <section className="panel-section"><span className="field-label">Postacie w scenie</span>{project.characters.map(character => <label className="character-checkbox" key={character.id}><input type="checkbox" checked={selectedScene.characterIds.includes(character.id)} onChange={event => onChange({ ...selectedScene, characterIds: event.target.checked ? [...selectedScene.characterIds, character.id] : selectedScene.characterIds.filter(id => id !== character.id) })} /><span><strong>{character.name}</strong><small>{character.role}</small></span></label>)}{project.characters.length === 0 && <p className="muted">Brak kart postaci.</p>}</section>
      <section className="panel-section"><label className="field-label" htmlFor="scene-notes">Notatki scenarzysty</label><textarea id="scene-notes" className="field-textarea" rows={5} value={selectedScene.notes} onChange={event => onChange({ ...selectedScene, notes: event.target.value })} /></section>
    </>}
  </>;
}
