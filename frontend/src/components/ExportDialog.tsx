import { useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './Modal';
import { FieldHelp } from './FieldHelp';
import { errorMessage } from '../services/workspaceData';
import type { ExportFormat } from '../services/export';

const formats: { value: ExportFormat; label: string; help: string; description: string }[] = [
  { value: 'fountain', label: 'Fountain (.fountain)', help: 'Fountain (.fountain)',
    description: 'Edytowalny scenariusz tekstowy z podziałem na elementy Fountain.' },
  { value: 'fdx', label: 'Final Draft (.fdx)', help: 'Final Draft (.fdx)',
    description: 'Scenariusz z typami akapitów do otwarcia w Final Draft i zgodnych edytorach.' },
  { value: 'pdf', label: 'PDF (.pdf)', help: 'PDF (.pdf)',
    description: 'US Letter, Courier Prime 12 pt, standardowe marginesy i wcięcia. Ze stroną tytułową i numeracją stron.' },
  { value: 'json', label: 'Projekt z kartami postaci (.json)', help: 'JSON (.json)',
    description: 'Pełny projekt, wraz z kartami postaci i metadanymi edytora.' },
];

const formatHelp = <span className="export-format-help">{formats.map(item =>
  <span className="export-format-help-item" key={item.value}><strong>{item.help}</strong><span>{item.description}</span></span>,
)}</span>;

export function ExportDialog({ title, onExport, onClose }: {
  title: string; onExport: (format: ExportFormat) => Promise<void>; onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('fountain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onExport(format); onClose(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal title="Eksport scenariusza" onClose={close} error={error}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
      <div className="modal-body">
        <p className="export-project-name">{title}</p>
        <div className="preference-label is-spaced">
          <label className="field-label" htmlFor="export-format">Format pliku</label>
          <FieldHelp id="export-format-help" label="Formaty eksportu" text={formatHelp} />
        </div>
        <select id="export-format" className="field-input" value={format} disabled={busy}
          aria-describedby="export-format-help" onChange={event => setFormat(event.target.value as ExportFormat)}>
          {formats.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" disabled={busy} onClick={close}>Anuluj</button>
        <button type="submit" className="button primary" disabled={busy}><Download size={14} />{busy ? 'Przygotowywanie pliku…' : 'Pobierz plik'}</button>
      </div>
    </form>
  </Modal>;
}
