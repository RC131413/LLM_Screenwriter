import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from './IconButton';

interface Props {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  error?: string;
}

export function PasswordField({ label, name, value, onChange, autoComplete, minLength, error }: Props) {
  const [visible, setVisible] = useState(false);
  return <div><label className="field-label" htmlFor={name}>{label}</label><div className="password-input"><input id={name} name={name} className="field-input" type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} value={value} onChange={event => onChange(event.target.value)} /><IconButton label={`${visible ? 'Ukryj' : 'Pokaż'}: ${label.toLocaleLowerCase('pl')}`} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>{error && <p className="form-error" id={`${name}-error`} role="alert">{error}</p>}</div>;
}
