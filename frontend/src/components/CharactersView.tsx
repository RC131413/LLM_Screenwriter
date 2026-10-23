import { useState } from 'react';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { errorMessage } from '../services/workspaceData';
import type { Character, Project } from '../types';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

const blankCharacter = (): Character => ({ id: '', name: '', age: '', role: '', goal: '', flaw: '', voice: '', appearance: '', backstory: '', voice_profile: {} });

export function CharactersView({ project, onSave, onDelete }: {
  project: Project; onSave: (character: Character) => Promise<void>; onDelete: (characterId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Character>();
  const [deleting, setDeleting] = useState<Character>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  function edit(character: Character) { setError(''); setEditing({ ...character }); }
  return <div className="workspace-view">
    <div className="view-heading"><div><span className="eyebrow">{project.title}</span><h2>Baza postaci</h2></div><button className="button" onClick={() => edit(blankCharacter())}><Plus size={15} />Dodaj postać</button></div>
    <div className="character-grid">{project.characters.map(character => <article className="character-card" key={character.id}>
      <div className="character-card-header"><div className="character-avatar"><UserRound size={22} strokeWidth={1.5} /></div><div><h3>{character.name}</h3><p>{character.age ? `${character.age} lat · ` : ''}{character.role}</p></div><IconButton label={`Edytuj postać ${character.name}`} onClick={() => edit(character)}><Pencil size={15} /></IconButton></div>
      <dl><dt>Wygląd</dt><dd>{character.appearance || 'Nie określono'}</dd><dt>Przeszłość / historia</dt><dd>{character.backstory || 'Nie określono'}</dd><dt>Cel</dt><dd>{character.goal || 'Nie określono'}</dd><dt>Słabość</dt><dd>{character.flaw || 'Nie określono'}</dd><dt>Sposób mówienia</dt><dd>{character.voice || 'Nie określono'}</dd></dl>
      <div className="character-card-footer"><span>{project.scenes.filter(scene => scene.characterIds.includes(character.id)).length} scen</span><IconButton label={`Usuń postać ${character.name}`} onClick={() => { setError(''); setDeleting(character); }}><Trash2 size={14} /></IconButton></div>
    </article>)}</div>
    {!project.characters.length && <div className="empty-view"><UserRound size={28} /><h3>Brak postaci</h3><button className="button" onClick={() => edit(blankCharacter())}><Plus size={15} />Dodaj postać</button></div>}
    {editing && <Modal title={editing.id ? 'Edytuj postać' : 'Nowa postać'} error={error} onClose={() => { if (!pending) setEditing(undefined); }}>
      <form onSubmit={async event => {
        event.preventDefault(); if (pending || !editing.name.trim()) return;
        setPending(true); setError('');
        try { await onSave({ ...editing, name: editing.name.trim().toLocaleUpperCase('pl') }); setEditing(undefined); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setPending(false); }
      }}><fieldset disabled={pending} className="form-fields">
        <div className="modal-body form-grid"><label>Imię<input className="field-input" required maxLength={150} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Wiek<input className="field-input" type="number" min="0" max="150" value={editing.age} onChange={event => setEditing({ ...editing, age: event.target.value })} /></label>
          <label className="span-two">Rola<input className="field-input" maxLength={255} value={editing.role} onChange={event => setEditing({ ...editing, role: event.target.value })} /></label>
          {([['appearance', 'Wygląd'], ['backstory', 'Przeszłość / historia'], ['goal', 'Cel'], ['flaw', 'Słabość'], ['voice', 'Sposób mówienia']] as const).map(([key, label]) => <div key={key} className="span-two"><label className="field-label" htmlFor={`character-${key}`}>{label}</label><textarea id={`character-${key}`} className="field-textarea" rows={key === 'backstory' ? 5 : 3} value={editing[key]} onChange={event => setEditing({ ...editing, [key]: event.target.value })} /></div>)}
        </div><div className="modal-actions"><button type="button" className="button" onClick={() => setEditing(undefined)}>Anuluj</button><button className="button primary" type="submit">{pending ? 'Zapisywanie…' : 'Zapisz postać'}</button></div>
      </fieldset></form>
    </Modal>}
    {deleting && <Modal title="Usuń postać" error={error} onClose={() => { if (!pending) setDeleting(undefined); }}><div className="modal-body"><p>Usunąć trwale kartę postaci {deleting.name}? Jej dialogi pozostaną w scenariuszu.</p></div>
      <div className="modal-actions"><button className="button" disabled={pending} onClick={() => setDeleting(undefined)}>Anuluj</button><button className="button danger" disabled={pending} onClick={async () => {
        setPending(true); setError('');
        try { await onDelete(deleting.id); setDeleting(undefined); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setPending(false); }
      }}>{pending ? 'Usuwanie…' : 'Usuń postać'}</button></div>
    </Modal>}
  </div>;
}
