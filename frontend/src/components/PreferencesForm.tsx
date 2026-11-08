import { useState } from 'react';
import type { UserPreferences } from '../types';
import { errorMessage } from '../services/workspaceData';
import { FieldHelp } from './FieldHelp';

const DIALOGUE_TONES = [
  'Neutralny, realistyczny', 'Oszczędny, z podtekstem', 'Lekki, ironiczny',
  'Napięty, konfliktowy', 'Ciepły, empatyczny', 'Formalny, powściągliwy',
];

function PreferenceLabel({ field, label, help, spaced = false }: { field: string; label: string; help: string; spaced?: boolean }) {
  return <div className={`preference-label${spaced ? ' is-spaced' : ''}`}>
    <label className="field-label" htmlFor={field}>{label}</label>
    <FieldHelp id={`${field}-help`} label={label} text={help} />
  </div>;
}

interface Props {
  preferences: UserPreferences;
  onSave: (preferences: UserPreferences) => Promise<UserPreferences>;
  onReset: () => Promise<UserPreferences>;
  onCancel: () => void;
  onSaved?: () => void;
}

export function PreferencesForm({ preferences, onSave, onReset, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const [customTone, setCustomTone] = useState(!DIALOGUE_TONES.includes(preferences.writing_style_preferences.dialogue_tone));
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
      const tone = style.dialogue_tone.trim();
      if (!tone) {
        setTab('writing'); setError('Wybierz ton dialogów lub wpisz własny opis.'); return;
      }
      setPending(true); setError(''); setMessage('');
      try {
        const saved = await onSave({ ...draft, writing_style_preferences: { ...style, dialogue_tone: tone } });
        setDraft(saved); setCustomTone(!DIALOGUE_TONES.includes(saved.writing_style_preferences.dialogue_tone));
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
        <FieldHelp id="preferences-scope-help" label="Zakres ustawień" text="Ustawienia konta dla kolejnych generowań we wszystkich projektach." />
      </div>
      <div className="modal-body preferences-body" id="preferences-panel" role="tabpanel" aria-labelledby={`preferences-tab-${tab}`}>
        {tab === 'writing' ? <>
          <PreferenceLabel field="stage-directions-style" label="Styl opisów akcji" help="Krótkie, rzeczowe opisy albo więcej detali obrazu i dźwięku. W obu stylach opisujemy to, co można pokazać na ekranie." />
          <select id="stage-directions-style" className="field-input" aria-describedby="stage-directions-style-help" value={style.stage_directions_style} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, stage_directions_style: event.target.value as typeof style.stage_directions_style } })}>
            <option value="concise_technical">Zwięzły, techniczny</option><option value="literary_descriptive">Plastyczny, opisowy</option>
          </select>
          <PreferenceLabel field="dialogue-tone" label="Domyślny ton dialogów" spaced help="Punkt wyjścia dla dialogów. Polecenie sceny, sytuacja i indywidualny głos postaci mają pierwszeństwo." />
          <select id="dialogue-tone" className="field-input" aria-describedby="dialogue-tone-help" value={customTone ? 'custom' : style.dialogue_tone} onChange={event => {
            const custom = event.target.value === 'custom'; setCustomTone(custom);
            if (!custom) setDraft({ ...draft, writing_style_preferences: { ...style, dialogue_tone: event.target.value } });
          }}>
            {DIALOGUE_TONES.map(tone => <option key={tone}>{tone}</option>)}<option value="custom">Własny ton…</option>
          </select>
          {customTone && <div className="custom-dialogue-tone"><PreferenceLabel field="custom-dialogue-tone" label="Własny ton dialogów" help="Opisz własny ton w maksymalnie 500 znakach, np. suchy humor i niedopowiedzenia." /><input id="custom-dialogue-tone" className="field-input" aria-describedby="custom-dialogue-tone-help" maxLength={500} required value={style.dialogue_tone} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, dialogue_tone: event.target.value } })} /></div>}
          <PreferenceLabel field="parentheticals" label="Wskazówki aktorskie w nawiasach" spaced help="Wyłączone: brak wskazówek w nowych wariantach. Oszczędnie: tylko gdy sposób wypowiedzi nie jest oczywisty. Standardowo: naturalne wskazówki w ważnych momentach dialogu. Bez dodawania ich do każdej kwestii i mechanicznych powtórzeń." />
          <select id="parentheticals" className="field-input" aria-describedby="parentheticals-help" value={style.parentheticals} onChange={event => setDraft({ ...draft, writing_style_preferences: { ...style, parentheticals: event.target.value as typeof style.parentheticals } })}>
            <option value="ignore">Wyłączone</option><option value="sparingly">Oszczędnie</option><option value="standard">Standardowo</option>
          </select>
        </> : <>
          <PreferenceLabel field="preferred-model" label="Główny model AI" help="Generowanie korzysta z lokalnego modelu Bielik 11B. Wybór innego modelu jest obecnie niedostępny." />
          <select id="preferred-model" className="field-input" aria-describedby="preferred-model-help" value="Bielik 11B (Lokalny)" disabled><option>Bielik 11B (Lokalny)</option></select>
          <div className="temperature-heading"><PreferenceLabel field="temperature" label="Temperatura (Kreatywność)" help="Niższa: bardziej przewidywalny tekst. Wyższa: większa różnorodność. Dotyczy Scenarzysty; agenci pomocniczy pracują z temperaturą 0." /><output htmlFor="temperature">{engine.temperature.toFixed(1)}</output></div>
          <input id="temperature" className="temperature-slider" aria-describedby="temperature-help" type="range" min="0" max="1" step="0.1" value={engine.temperature} onChange={event => setDraft({ ...draft, llm_preferences: { ...engine, temperature: Number(event.target.value) } })} />
          <div className="temperature-scale" aria-hidden="true"><span>0.0</span><span>1.0</span></div>
          <PreferenceLabel field="max-tokens" label="Limit odpowiedzi modelu (tokeny)" spaced help="Limit techniczny ustala aplikacja. Oczekiwaną długość fragmentu sceny określ w poleceniu." />
          <input id="max-tokens" className="field-input" type="number" disabled value={engine.max_tokens} aria-describedby="max-tokens-help" />
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="modal-actions preferences-actions">
        <button type="button" className="button" disabled={pending} onClick={onCancel}>Anuluj</button>
        <button type="button" className="button" disabled={pending} onClick={async () => {
          setPending(true); setError(''); setMessage('');
          try { const defaults = await onReset(); setDraft(defaults); setCustomTone(!DIALOGUE_TONES.includes(defaults.writing_style_preferences.dialogue_tone)); setMessage('Przywrócono domyślne preferencje.'); }
          catch (failure) { setError(errorMessage(failure)); }
          finally { setPending(false); }
        }}>Resetuj</button>
        <button type="submit" disabled={pending} className="button primary">{pending ? 'Zapisywanie…' : 'Zapisz preferencje'}</button>
      </div>
    </form>;
}
