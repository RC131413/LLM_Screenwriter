import type { UserPreferences } from '../types';
import { Modal } from './Modal';
import { PreferencesForm } from './PreferencesForm';

export function PreferencesDialog({ preferences, onSave, onReset, onClose }: {
  preferences: UserPreferences;
  onSave: (preferences: UserPreferences) => Promise<UserPreferences>;
  onReset: () => Promise<UserPreferences>;
  onClose: () => void;
}) {
  return <Modal title="Ustawienia i AI" onClose={onClose}>
    <PreferencesForm preferences={preferences} onSave={onSave} onReset={onReset} onCancel={onClose} onSaved={onClose} />
  </Modal>;
}
