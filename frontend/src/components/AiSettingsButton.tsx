import { Settings } from 'lucide-react';

export function AiSettingsButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="dashboard-settings-button" onClick={onClick}>
    <Settings size={18} /><span>Ustawienia i AI</span>
  </button>;
}
