import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Modal acessível baseado em <dialog>. Em telas pequenas vira folha inferior. */
export function Dialog({ open, onClose, title, description, children, footer, className, side }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  side?: 'center' | 'right';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(
        'backdrop:bg-black/50 bg-card text-foreground border shadow-xl p-0 m-0 max-w-none',
        side === 'right'
          ? 'ml-auto h-dvh max-h-dvh w-full sm:w-[420px] rounded-none'
          : 'mt-auto sm:m-auto w-full sm:max-w-lg rounded-t-xl sm:rounded-lg max-h-[90dvh]',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[inherit] h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-md p-2 -m-2 hover:bg-muted" aria-label="Fechar"><X className="size-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
