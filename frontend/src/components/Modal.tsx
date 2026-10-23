import { useEffect, useRef } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export function Modal({ title, children, onClose, error }: { title: string; children: ReactNode; onClose: () => void; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  function isBackdrop(event: PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      backdropPress.current = event.button === 0 && isBackdrop(event)
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    }}
    onPointerCancel={() => { backdropPress.current = null; }}
    onPointerUp={event => {
      const press = backdropPress.current;
      backdropPress.current = null;
      // A selection drag that starts inside the form must never dismiss it.
      if (press && press.pointerId === event.pointerId && isBackdrop(event) && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 6) onClose();
    }}>
    <div className="modal-header"><h2>{title}</h2><IconButton label="Zamknij okno" onClick={onClose}><X size={18} /></IconButton></div>
    {error && <p className="form-error modal-error" role="alert">{error}</p>}
    {children}
  </dialog>;
}
