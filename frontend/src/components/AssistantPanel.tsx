import { useEffect, useState } from 'react';
import { Check, CheckCheck, ChevronRight, History, RotateCcw, Save, X } from 'lucide-react';
import { api } from '../services/api';
import type { ApiRunDetail, ApiSceneVariant } from '../services/api';
import { allPages, errorMessage } from '../services/workspaceData';
import { checkScene } from '../services/sceneValidation';
import type { Project, Scene } from '../types';
import { formatAct, screenplayModel } from '../types';
import { IconButton } from './IconButton';
import { Modal } from './Modal';
import { AgentProgress } from './AgentProgress';
import { SceneContext } from './SceneContext';
import { usePromptHistory } from '../hooks/usePromptHistory';
import { PromptHistoryDialog } from './PromptHistoryDialog';
import { RequestState } from './RequestState';

interface Props {
  project: Project; scene: Scene | undefined; onSelect: (id: string) => void; onChange: (scene: Scene) => void;
  onPrepare: () => Promise<void>; onApply: (variantId: number) => Promise<void>; onClose: () => void;
}

export function AssistantPanel({ project, scene, onSelect, onChange, onPrepare, onApply, onClose }: Props) {
  const [tab, setTab] = useState<'generate' | 'context' | 'check'>('generate');
  const [brief, setBrief] = useState('');
  const [variants, setVariants] = useState<ApiSceneVariant[]>([]);
  const [run, setRun] = useState<ApiRunDetail | null>(null);
  const [selected, setSelected] = useState<number>();
  const [preview, setPreview] = useState<ApiSceneVariant>();
  const [findings, setFindings] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const promptHistory = usePromptHistory(project.id, scene?.id);
  const sceneId = scene?.id;
  useEffect(() => { setBrief(''); setHistoryOpen(false); setPreview(undefined); setFindings(null); setMessage(''); }, [sceneId]);
  useEffect(() => { setFindings(null); }, [scene]);
  useEffect(() => {
    setVariants([]); setRun(null); setSelected(undefined); setError('');
    if (!sceneId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    async function load() {
      try {
        const options = { signal: controller.signal };
        const [stored, runs] = await Promise.all([
          allPages(params => api.variants.listForScene(Number(sceneId), params, options), controller.signal),
          api.runs.list(Number(sceneId), { limit: 1 }, options),
        ]);
        const detail = runs.items[0] ? await api.runs.get(runs.items[0].id, options) : null;
        if (controller.signal.aborted) return;
        setVariants(stored); setRun(detail);
        setSelected(previous => stored.some(variant => variant.id === previous) ? previous : stored.find(variant => variant.is_selected)?.id ?? stored[0]?.id);
        if (detail && ['pending', 'running'].includes(detail.status)) timer = setTimeout(() => void load(), 3000);
      } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sceneId, version]);

  const chosen = variants.find(variant => variant.id === selected);
  async function chooseVariant(variantId: number) {
    if (pending) return;
    setPending(true); setError('');
    try {
      await onPrepare(); await api.variants.select(variantId, { apply_to_scene: false });
      setSelected(variantId);
      setVariants(current => current.map(variant => ({ ...variant, is_selected: variant.id === variantId })));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  async function savePrompt() {
    if (!scene || !brief.trim() || pending) return;
    setPending(true); setError(''); setMessage('');
    try {
      await onPrepare(); await promptHistory.recordPrompt(brief.trim());
      setMessage('Prompt zapisany. Silnik generowania nie jest jeszcze podłączony.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  async function apply() {
    if (!chosen || pending) return;
    setPending(true); setError('');
    try { await onApply(chosen.id); setVersion(value => value + 1); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  return <aside className="assistant-panel" aria-label="Asystent scenariusza">
    <div className="assistant-heading"><div><h2>Asystent scenariusza</h2><span className="model-caption">{screenplayModel}</span></div><IconButton className="panel-close" label="Zamknij panel asystenta" onClick={onClose}><X size={16} /></IconButton></div>
    <div className="panel-tabs" role="tablist" aria-label="Narzędzia asystenta">{([['generate', 'Prompty i warianty'], ['context', 'Kontekst'], ['check', 'Kontrola']] as const).map(([id, label]) => <button key={id} role="tab" id={`assistant-tab-${id}`} aria-controls="assistant-content" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="assistant-scroll" id="assistant-content" role="tabpanel" aria-labelledby={`assistant-tab-${tab}`}>
      {tab === 'context' ? <SceneContext key={project.id} project={project} scene={scene} onSelect={onSelect} onChange={onChange} /> : !scene ? <p className="empty-search">Dodaj scenę, aby rozpocząć.</p> : tab === 'generate' ? <>
        <section className="panel-section"><span className="eyebrow">BIEŻĄCA SCENA</span><div className="current-scene"><span className="scene-token">{String(scene.scene_number).padStart(2, '0')}</span><div><strong>{scene.title}</strong><small>Akt {formatAct(scene.act)} · {scene.characterIds.length} postaci</small></div></div></section>
        <section className="panel-section"><div className="prompt-field-heading"><label className="field-label" htmlFor="scene-brief">Kierunek sceny</label><IconButton className="prompt-history-trigger" label="Historia promptów" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}><History size={16} /><small>{promptHistory.entries.length}</small></IconButton></div>
          <textarea id="scene-brief" className="field-textarea" maxLength={32000} rows={4} value={brief} disabled={pending} onChange={event => setBrief(event.target.value)} />
          <button className="button primary full-width" disabled={pending || !brief.trim()} onClick={() => void savePrompt()}><Save size={14} />{pending ? 'Zapisywanie…' : 'Zapisz prompt'}</button>
          {message && <p role="status" className="small">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
        </section>
        {loading ? <RequestState loading /> : <AgentProgress run={run} />}
        <section className="panel-section variants-section"><div className="prompt-field-heading"><span className="eyebrow">ZAPISANE WARIANTY</span><IconButton label="Odśwież warianty i przebieg" disabled={loading || pending} onClick={() => setVersion(value => value + 1)}><RotateCcw size={15} /></IconButton></div>
          {!loading && !variants.length && <p className="muted small">Brak wariantów dla tej sceny.</p>}
          <div className="variant-list">{variants.map(variant => <div key={variant.id} className={`variant-item ${selected === variant.id ? 'selected' : ''}`}><label><input type="radio" name="scene-variant" disabled={pending} checked={selected === variant.id} onChange={() => void chooseVariant(variant.id)} /><strong>{variant.title || `Wariant ${variant.variant_number}`}</strong></label>
            <p>{variant.critic_feedback || 'Brak oceny krytyka.'}</p>{variant.critic_score !== null && <small>Ocena: {variant.critic_score}</small>}<button className="text-button" onClick={() => setPreview(variant)}>Podgląd tekstu<ChevronRight size={13} /></button>
          </div>)}</div>
          {variants.length > 0 && <button className="button primary full-width" disabled={!chosen || pending} onClick={() => void apply()}><Check size={15} />{pending ? 'Zapisywanie…' : 'Zastosuj wybrany wariant'}</button>}
        </section>
      </> : <><section className="panel-section"><h3>Kontrola formatowania</h3><button className="button full-width" onClick={() => setFindings(checkScene(scene, project.characters))}><CheckCheck size={16} />Sprawdź scenę</button>{findings !== null && <div className="check-results" role="status">{findings.length ? <><strong>{findings.length} uwag</strong><ul>{findings.map(finding => <li key={finding}>{finding}</li>)}</ul></> : <p className="check-success"><Check size={16} />Brak uwag do formatu i postaci.</p>}</div>}</section>
        <section className="panel-section"><span className="eyebrow">KONTEKST NARRACYJNY</span>{project.characters.filter(character => scene.characterIds.includes(character.id)).map(character => <div className="character-context" key={character.id}><strong>{character.name}</strong><p>{character.goal}</p><small>{character.voice}</small><dl className="metadata-list"><dt>Wygląd</dt><dd>{character.appearance || 'Nie określono'}</dd><dt>Przeszłość / historia</dt><dd>{character.backstory || 'Nie określono'}</dd></dl></div>)}</section></>}
    </div>
    {historyOpen && scene && <PromptHistoryDialog sceneTitle={scene.title} entries={promptHistory.entries} loading={promptHistory.loading} error={promptHistory.error} onRetry={promptHistory.retry} onClose={() => setHistoryOpen(false)} onSelect={prompt => { setBrief(prompt); setHistoryOpen(false); requestAnimationFrame(() => document.getElementById('scene-brief')?.focus()); }} />}
    {preview && <Modal error={error} title={`Wariant: ${preview.title || preview.variant_number}`} onClose={() => setPreview(undefined)}><div className="variant-preview"><pre className="variant-text">{preview.generated_full_text}</pre></div><div className="modal-actions"><button className="button" disabled={pending} onClick={() => setPreview(undefined)}>Zamknij</button><button className="button primary" disabled={pending} onClick={async () => { await chooseVariant(preview.id); setPreview(undefined); }}>Wybierz wariant</button></div></Modal>}
  </aside>;
}
