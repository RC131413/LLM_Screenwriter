import { History } from 'lucide-react';
import type { PromptHistoryEntry } from '../types';
import { Modal } from './Modal';

const date = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PromptHistoryDialog({ sceneTitle, entries, onSelect, onClose }: {
  sceneTitle: string;
  entries: PromptHistoryEntry[];
  onSelect: (prompt: string) => void;
  onClose: () => void;
}) {
  return <Modal title="Historia promptów" onClose={onClose}>
    <div className="modal-body prompt-history-body">
      <div className="prompt-history-summary"><span>{sceneTitle || 'Bez tytułu'}</span><small>{entries.length}</small></div>
      {entries.length ? <ol className="prompt-history-list">{entries.map((entry, index) => <li key={entry.id}>
        <button type="button" className="prompt-history-entry" title={entry.prompt} aria-label={`Użyj promptu ${entries.length - index}: ${entry.prompt}`} onClick={() => onSelect(entry.prompt)}>
          <span className="prompt-history-meta"><span>#{entries.length - index}</span><time dateTime={entry.created_at}>{date.format(new Date(entry.created_at))}</time></span>
          <span className="prompt-history-text">{entry.prompt}</span>
        </button>
      </li>)}</ol> : <div className="prompt-history-empty"><History size={25} strokeWidth={1.5} /><p>Brak zapisanych promptów dla tej sceny.</p></div>}
    </div>
    <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Zamknij</button></div>
  </Modal>;
}
