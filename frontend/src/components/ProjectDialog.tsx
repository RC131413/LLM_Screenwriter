import { useState } from 'react';
import type { Project } from '../types';
import { Modal } from './Modal';
import { errorMessage } from '../services/workspaceData';

export type ProjectDetails = Pick<Project, 'title' | 'genre' | 'logline' | 'synopsis' | 'target_audience'>;

interface Props {
  project?: Project;
  onSave: (details: ProjectDetails) => Promise<void>;
  onClose: () => void;
}

export function ProjectDialog({ project, onSave, onClose }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<ProjectDetails>(() => ({
    title: project?.title ?? '',
    genre: project?.genre ?? '',
    logline: project?.logline ?? '',
    synopsis: project?.synopsis ?? '',
    target_audience: project?.target_audience ?? '',
  }));

  return <Modal title={project ? 'Edytuj projekt' : 'Nowy projekt'} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!draft.title.trim() || pending) return;
      setPending(true); setError('');
      try { await onSave({ ...draft, title: draft.title.trim() }); }
      catch (failure) { setError(errorMessage(failure)); }
      finally { setPending(false); }
    }}>
      <fieldset disabled={pending} className="form-fields">
      <div className="modal-body project-form">
        <label className="field-label" htmlFor="project-title">Tytuł</label>
        <input id="project-title" name="title" className="field-input" required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <label className="field-label spaced" htmlFor="project-genre">Gatunek</label>
        <input id="project-genre" name="genre" className="field-input" value={draft.genre} onChange={event => setDraft({ ...draft, genre: event.target.value })} />
        <label className="field-label spaced" htmlFor="project-target-audience">Grupa docelowa</label>
        <input id="project-target-audience" name="target_audience" className="field-input" maxLength={255} value={draft.target_audience} onChange={event => setDraft({ ...draft, target_audience: event.target.value })} />
        <label className="field-label spaced" htmlFor="project-logline">Logline</label>
        <textarea id="project-logline" name="logline" className="field-textarea" rows={3} value={draft.logline} onChange={event => setDraft({ ...draft, logline: event.target.value })} />
        <label className="field-label spaced" htmlFor="project-synopsis">Streszczenie</label>
        <textarea id="project-synopsis" name="synopsis" className="field-textarea project-synopsis" rows={8} value={draft.synopsis} onChange={event => setDraft({ ...draft, synopsis: event.target.value })} />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <button type="button" disabled={pending} className="button" onClick={onClose}>Anuluj</button>
        <button type="submit" disabled={pending} className="button primary">{pending ? 'Zapisywanie…' : project ? 'Zapisz projekt' : 'Utwórz projekt'}</button>
      </div>
      </fieldset>
    </form>
  </Modal>;
}
