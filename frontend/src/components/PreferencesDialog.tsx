import type { UserPreferences } from '../types';
import { Modal } from './Modal';
import { PreferencesForm } from './PreferencesForm';

export function PreferencesDialog({ preferences, onSave, onClose }: {
  preferences: UserPreferences;
  onSave: (preferences: UserPreferences) => boolean;
  onClose: () => void;
}) {
  return <Modal title="Ustawienia i AI" onClose={onClose}>
    <PreferencesForm preferences={preferences} onSave={onSave} onCancel={onClose} onSaved={onClose} />
  </Modal>;
}
