import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/** A hover/focus hint that stays above dialogs and their scrolling form bodies. */
export function FieldHelp({ id, label, text }: { id: string; label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function show() { clearTimeout(closeTimer.current); setOpen(true); }
  function close() { clearTimeout(closeTimer.current); setOpen(false); }

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    const hint = tooltip.current;
    const button = trigger.current;
    if (!hint || !button || !open) return;
    // Native popovers use the top layer, so the modal's overflow cannot clip them.
    const nativePopover = typeof hint.showPopover === 'function';
    if (nativePopover && !hint.matches(':popover-open')) hint.showPopover();
    function place() {
      const anchor = button!.getBoundingClientRect();
      const bounds = hint!.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
      const below = anchor.bottom + 6;
      const footer = button!.closest('form')?.querySelector('.modal-actions')?.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight - 8, footer ? footer.top - 8 : window.innerHeight - 8);
      const top = below + bounds.height <= bottom ? below : Math.max(8, anchor.top - bounds.height - 6);
      hint!.style.left = `${left}px`; hint!.style.top = `${top}px`;
    }
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      if (nativePopover && hint.matches(':popover-open')) hint.hidePopover();
    };
  }, [open, text]);

  return <span className="field-help" ref={wrapper} onPointerEnter={show} onPointerLeave={event => {
    if (event.pointerType === 'mouse' || document.activeElement !== trigger.current) closeTimer.current = setTimeout(() => setOpen(false), 120);
  }}>
    <button ref={trigger} type="button" className="field-help-trigger" aria-label={`Informacja: ${label}`}
      aria-describedby={id} onFocus={show} onBlur={close} onClick={show}><Info size={14} aria-hidden="true" /></button>
    <span ref={tooltip} id={id} role="tooltip" popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined} className="field-help-tooltip" hidden={!open}
      onPointerEnter={show}>{text}</span>
  </span>;
}
