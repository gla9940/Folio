import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props { side: 'left' | 'right'; open: boolean; title: string; onClose: () => void; children: ReactNode }
export function SidePanel({ side, open, title, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = ref.current!;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const items = focusable();
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  return <>
    {open && <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />}
    <aside ref={ref} className={`side-panel notranslate ${side}-panel ${open ? 'is-open' : ''}`} translate="no" lang="ko" role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label={title}>
      <div className="panel-heading"><h2>{title}</h2><button className="icon-button panel-close" aria-label={`${title} 닫기`} onClick={onClose}><X size={20} /></button></div>
      {children}
    </aside>
  </>;
}
