import { useState } from 'react';
import type { UserPreferences } from '../types';
import { errorMessage } from '../services/workspaceData';

interface Props {
  preferences: UserPreferences;
  onSave: (preferences: UserPreferences) => Promise<UserPreferences>;
  onReset: () => Promise<UserPreferences>;
  onCancel: () => void;
  onSaved?: () => void;
}

export function PreferencesForm({ preferences, onSave, onReset, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const [tokenLimit, setTokenLimit] = useState(String(preferences.llm_preferences.max_tokens));
  const [tab, setTab] = useState<'writing' | 'engine'>('writing');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const tabs = [{ id: 'writing', label: 'Styl pisania' }, { id: 'engine', label: 'Preferencje silnika' }] as const;
  const style = draft.writing_style_preferences;
  const engine = draft.llm_preferences;

  return <form className="preferences-form" onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      const maxTokens = Number(tokenLimit);
      if (!tokenLimit.trim() || !Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
        setTab('engine'); setError('Podaj dodatnią, całkowitą liczbę tokenów.'); return;
      }
      setPending(true); setError(''); setMessage('');
      try {
        await onSave({ ...draft, llm_preferences: { ...engine, max_tokens: maxTokens } });
        setMessage('Preferencje zapisane.'); onSaved?.();
      } catch (failure) { setError(errorMessage(failure)); }
      finally { setPending(false); }
    }}>
      <div className="preferences-tabs" role="tablist" aria-label="Ustawienia i AI">
        {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`preferences-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="preferences-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          setTab(tabs[next].id); document.getElementById(`preferences-tab-${tabs[next].id}`)?.focus();
        }}>{item.label}</button>)}
      </div>
      <div className="modal-body preferences-body" id="preferences-panel" role="tabpanel" aria-labelledby={`preferences-tab-${tab}`}>
        {tab === 'writing' ? <>
          <label className="field-label" htmlFor="stage-directions-style">Styl didaskaliów</label>
          <select id="stage-directions-style" className="field-input" value={style.stage_directions_style} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, stage_directions_style: event.target.value as typeof style.stage_directions_style } })}>
            <option value="concise_technical">Zwięzły/Techniczny</option><option value="literary_descriptive">Literacki/Opisowy</option>
          </select>
          <label className="field-label spaced" htmlFor="dialogue-tone">Domyślny ton dialogów</label>
          <input id="dialogue-tone" className="field-input" value={style.dialogue_tone} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, dialogue_tone: event.target.value } })} />
          <span className="field-label spaced" id="parentheticals-label">Wskazówki aktorskie w nawiasach</span>
          <label className="preferences-checkbox"><input type="checkbox" role="switch" aria-labelledby="parentheticals-label" checked={style.parentheticals === 'sparingly'} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, parentheticals: event.target.checked ? 'sparingly' : 'ignore' } })} /><span>{style.parentheticals === 'sparingly' ? 'Używaj oszczędnie' : 'Ignoruj'}</span></label>
        </> : <>
          <label className="field-label" htmlFor="preferred-model">Główny model AI</label>
          <select id="preferred-model" className="field-input" value="Bielik 11B (Lokalny)" disabled><option>Bielik 11B (Lokalny)</option></select>
          <div className="temperature-heading"><label className="field-label" htmlFor="temperature">Temperatura (Kreatywność)</label><output htmlFor="temperature">{engine.temperature.toFixed(1)}</output></div>
          <input id="temperature" className="temperature-slider" type="range" min="0" max="1" step="0.1" value={engine.temperature} onChange={event => setDraft({ ...draft, llm_preferences: { ...engine, temperature: Number(event.target.value) } })} />
          <div className="temperature-scale" aria-hidden="true"><span>0.0</span><span>1.0</span></div>
          <label className="field-label spaced" htmlFor="max-tokens">Max długość odpowiedzi (Tokeny)</label>
          <input id="max-tokens" className="field-input" type="number" min="1" max="32768" step="1" required inputMode="numeric" value={tokenLimit} onChange={event => { setTokenLimit(event.target.value); setError(''); }} />
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="modal-actions preferences-actions">
        <button type="button" className="button" disabled={pending} onClick={onCancel}>Anuluj</button>
        <button type="button" className="button" disabled={pending} onClick={async () => {
          setPending(true); setError(''); setMessage('');
          try { const defaults = await onReset(); setDraft(defaults); setTokenLimit(String(defaults.llm_preferences.max_tokens)); setMessage('Przywrócono domyślne preferencje.'); }
          catch (failure) { setError(errorMessage(failure)); }
          finally { setPending(false); }
        }}>Resetuj</button>
        <button type="submit" disabled={pending} className="button primary">{pending ? 'Zapisywanie…' : 'Zapisz preferencje'}</button>
      </div>
    </form>;
}
