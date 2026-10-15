import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, ChevronRight, Play, Square, X } from 'lucide-react';
import { agentRoles, checkScene, generateVariants } from '../services/mockAi';
import type { Project, Scene, SceneVariant } from '../types';
import { formatAct, screenplayModel } from '../types';
import { IconButton } from './IconButton';
import { Modal } from './Modal';
import { AgentProgress } from './AgentProgress';

interface Props { project: Project; scene: Scene | undefined; onChange: (scene: Scene) => void; onApply: (variant: SceneVariant) => void; onClose: () => void }
export function AssistantPanel({ project, scene, onChange, onApply, onClose }: Props) {
  const [tab, setTab] = useState<'generate' | 'context' | 'check'>('generate');
  const [brief, setBrief] = useState('Zbuduj napięcie przez podtekst. Zachowaj oszczędne dialogi.');
  const [count, setCount] = useState(3);
  const [agent, setAgent] = useState(-1);
  const [running, setRunning] = useState(false);
  const [variants, setVariants] = useState<SceneVariant[]>([]);
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<SceneVariant>();
  const [findings, setFindings] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort(); setRunning(false); setAgent(-1); setVariants([]); setSelected(undefined); setPreview(undefined); setFindings(null); setError('');
    return () => controller.current?.abort();
  }, [project.id, scene, project.characters]);
  useEffect(() => { setFindings(null); }, [scene]);
  const chosen = variants.find(variant => variant.id === selected);
  const currentAct = project.acts.find(act => act.act_number === scene?.act);
  async function generate() {
    if (!scene || running) return;
    const request = new AbortController(); controller.current = request;
    setRunning(true); setError(''); setVariants([]); setSelected(undefined);
    try {
      const result = await generateVariants(scene, project.characters, brief, count, request.signal, setAgent);
      if (!request.signal.aborted) { setVariants(result); setSelected(result[0]?.id); setAgent(agentRoles.length); }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Nie udało się utworzyć wariantów.');
    } finally { if (controller.current === request) setRunning(false); }
  }
  return <aside className="assistant-panel" aria-label="Asystent scenariusza">
    <div className="assistant-heading"><div><h2>Asystent scenariusza</h2><span className="model-caption"><span className="status-dot" />{screenplayModel} <span>· symulacja</span></span></div><IconButton className="panel-close" label="Zamknij panel asystenta" onClick={onClose}><X size={16} /></IconButton></div>
    <div className="panel-tabs" role="tablist" aria-label="Narzędzia asystenta">
      {([['generate', 'Generuj'], ['context', 'Kontekst'], ['check', 'Kontrola']] as const).map(([id, label]) => <button key={id} role="tab" id={`assistant-tab-${id}`} aria-controls="assistant-content" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div className="assistant-scroll" id="assistant-content" role="tabpanel" aria-labelledby={`assistant-tab-${tab}`}>
      {!scene ? <p className="empty-search">Dodaj scenę, aby rozpocząć.</p> : tab === 'generate' ? <>
        <section className="panel-section"><span className="eyebrow">BIEŻĄCA SCENA</span><div className="current-scene"><span className="scene-token">{String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}</span><div><strong>{scene.title}</strong><small>Akt {formatAct(scene.act)} · {scene.characterIds.length} postaci</small></div></div></section>
        <section className="panel-section"><label className="field-label" htmlFor="scene-brief">Kierunek sceny</label><textarea id="scene-brief" className="field-textarea" rows={4} value={brief} disabled={running} onChange={event => setBrief(event.target.value)} /><div className="variant-count"><span>Warianty</span><div className="segmented-control" aria-label="Liczba wariantów">{[1, 2, 3].map(number => <button key={number} aria-pressed={count === number} disabled={running} onClick={() => setCount(number)}>{number}</button>)}</div></div>
          <button className="button primary full-width" onClick={running ? () => { controller.current?.abort(); setAgent(-1); } : generate}>{running ? <Square size={13} /> : <Play size={14} />}{running ? 'Zatrzymaj' : 'Generuj warianty'}</button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
        <AgentProgress agent={agent} running={running} hasVariants={variants.length > 0} error={error} />
        {variants.length > 0 && <section className="panel-section variants-section"><span className="eyebrow">WARIANTY SCENY</span><div className="variant-list">{variants.map((variant, index) => <div key={variant.id} className={`variant-item ${selected === variant.id ? 'selected' : ''}`}><label><input type="radio" name="scene-variant" checked={selected === variant.id} onChange={() => setSelected(variant.id)} /><strong>{String.fromCharCode(65 + index)} · {variant.title}</strong></label><p>{variant.description}</p><button className="text-button" onClick={() => setPreview(variant)}>Podgląd tekstu<ChevronRight size={13} /></button></div>)}</div><button className="button primary full-width" disabled={!chosen} onClick={() => { if (chosen) { onApply(chosen); setVariants([]); setSelected(undefined); setAgent(-1); } }}><Check size={15} />Zastosuj wybrany wariant</button></section>}
      </> : tab === 'context' ? <>
        <section className="panel-section"><label className="field-label" htmlFor="scene-act">Akt</label><select id="scene-act" className="field-input" value={scene.act} onChange={event => onChange({ ...scene, act: Number(event.target.value) })}>{project.acts.map(act => <option value={act.act_number} key={act.act_number}>Akt {formatAct(act.act_number)}{act.title && ` · ${act.title}`}</option>)}</select><label className="field-label spaced" htmlFor="scene-synopsis">Cel sceny</label><textarea id="scene-synopsis" className="field-textarea" rows={4} value={scene.synopsis} onChange={event => onChange({ ...scene, synopsis: event.target.value })} /></section>
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
        <section className="panel-section"><span className="field-label">Postacie w scenie</span>{project.characters.map(character => <label className="character-checkbox" key={character.id}><input type="checkbox" checked={scene.characterIds.includes(character.id)} onChange={event => onChange({ ...scene, characterIds: event.target.checked ? [...scene.characterIds, character.id] : scene.characterIds.filter(id => id !== character.id) })} /><span><strong>{character.name}</strong><small>{character.role}</small></span></label>)}{project.characters.length === 0 && <p className="muted">Brak kart postaci.</p>}</section>
        <section className="panel-section"><label className="field-label" htmlFor="scene-notes">Notatki scenarzysty</label><textarea id="scene-notes" className="field-textarea" rows={5} value={scene.notes} onChange={event => onChange({ ...scene, notes: event.target.value })} /></section>
      </> : <>
        <section className="panel-section"><h3>Kontrola formatowania</h3><button className="button full-width" onClick={() => setFindings(checkScene(scene, project.characters))}><CheckCheck size={16} />Sprawdź scenę</button>{findings !== null && <div className="check-results" role="status">{findings.length ? <><strong>{findings.length} uwag</strong><ul>{findings.map(finding => <li key={finding}>{finding}</li>)}</ul></> : <p className="check-success"><Check size={16} />Brak uwag do formatu i postaci.</p>}</div>}</section>
        <section className="panel-section"><span className="eyebrow">KONTEKST NARRACYJNY</span>{project.characters.filter(character => scene.characterIds.includes(character.id)).map(character => <div className="character-context" key={character.id}><strong>{character.name}</strong><p>{character.goal}</p><small>{character.voice}</small><dl className="metadata-list"><dt>Wygląd</dt><dd>{character.appearance || 'Nie określono'}</dd><dt>Przeszłość / historia</dt><dd>{character.backstory || 'Nie określono'}</dd></dl></div>)}<p className="muted small">Ocena spójności psychologicznej: niedostępna w symulacji.</p></section>
      </>}
    </div>
    <div className="assistant-footer"><span className="status-dot" /><span>Dane lokalne · brak połączenia z LLM</span></div>
    {preview && <Modal title={`Wariant: ${preview.title}`} onClose={() => setPreview(undefined)}><div className="variant-preview"><strong>{scene?.heading}</strong>{preview.blocks.map(block => <p key={block.id} className={`preview-${block.type}`}>{block.text}</p>)}</div><div className="modal-actions"><button className="button" onClick={() => setPreview(undefined)}>Zamknij</button><button className="button primary" onClick={() => { setSelected(preview.id); setPreview(undefined); }}>Wybierz wariant</button></div></Modal>}
  </aside>;
}
