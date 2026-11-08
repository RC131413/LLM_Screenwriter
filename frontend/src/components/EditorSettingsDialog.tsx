import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { EditorSettings } from '../types';
import { FieldHelp } from './FieldHelp';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

function SettingLabel({ id, label, help }: { id: string; label: string; help: string }) {
  return <div className="editor-setting-name"><label htmlFor={id}>{label}</label>
    <FieldHelp id={`${id}-help`} label={label} text={help} />
  </div>;
}

export function EditorSettingsDialog({ settings, onChange, onClose }: {
  settings: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
  onClose: () => void;
}) {
  return <Modal title="Ustawienia edytora" onClose={onClose}>
    <form className="editor-settings-form" onSubmit={event => { event.preventDefault(); onClose(); }}>
      <div className="modal-body">
        <div className="settings-row"><div className="editor-setting-name"><span>Czcionka scenariusza</span>
          <FieldHelp id="editor-font-help" label="Czcionka scenariusza" text="Stała czcionka Courier New 12 pt. Wielkość podglądu zmienisz powiększeniem widoku." />
        </div><span className="muted">Courier New · 12 pt</span></div>
        <div className="settings-row">
          <SettingLabel id="editor-zoom" label="Powiększenie widoku" help="Powiększa wyłącznie podgląd sceny, w zakresie 50–200%. Ustawienia widoku są zapamiętywane w tej przeglądarce osobno dla każdego konta." />
          <div className="zoom-stepper">
            <IconButton label="Zmniejsz powiększenie" disabled={settings.zoom <= 50} onClick={() => onChange({ zoom: settings.zoom - 10 })}><Minus size={15} /></IconButton>
            <output id="editor-zoom" aria-label="Powiększenie widoku" aria-describedby="editor-zoom-help">{settings.zoom}%</output>
            <IconButton label="Zwiększ powiększenie" disabled={settings.zoom >= 200} onClick={() => onChange({ zoom: settings.zoom + 10 })}><Plus size={15} /></IconButton>
            <IconButton label="Przywróć powiększenie 100%" disabled={settings.zoom === 100} onClick={() => onChange({ zoom: 100 })}><RotateCcw size={14} /></IconButton>
          </div>
        </div>
        <div className="settings-row">
          <SettingLabel id="editor-spellcheck" label="Sprawdzanie pisowni" help="Włącza podkreślanie potencjalnych błędów w opisach akcji, dialogach i wskazówkach aktorskich. Wymaga polskiego słownika w przeglądarce." />
          <input id="editor-spellcheck" className="editor-setting-toggle" type="checkbox" role="switch" aria-describedby="editor-spellcheck-help" checked={settings.spellCheck} onChange={event => onChange({ spellCheck: event.target.checked })} />
        </div>
        <div className="settings-row">
          <SettingLabel id="editor-block-types" label="Etykiety typów elementów" help="Pokazuje nad elementami pomocnicze etykiety, np. Akcja, Postać i Dialog. Są częścią widoku edytora i nie trafiają do tekstu sceny ani eksportu." />
          <input id="editor-block-types" className="editor-setting-toggle" type="checkbox" role="switch" aria-describedby="editor-block-types-help" checked={settings.showBlockTypes} onChange={event => onChange({ showBlockTypes: event.target.checked })} />
        </div>
      </div>
      <div className="modal-actions"><button type="submit" className="button primary">Gotowe</button></div>
    </form>
  </Modal>;
}
