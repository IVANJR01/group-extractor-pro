import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const STEPS = ['Arquivo', 'Origem', 'Visualizar', 'Mapear colunas', 'Validar', 'Prévia', 'Confirmar', 'Processar', 'Relatório'];

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Etapas da importação">
      {STEPS.map((s, i) => (
        <li key={s} className={cn('flex min-w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
          i === current ? 'border-primary bg-accent text-accent-foreground' : i < current ? 'text-foreground' : 'text-muted-foreground')}
          aria-current={i === current ? 'step' : undefined}>
          <span className={cn('grid size-5 place-items-center rounded-full text-[10px]', i < current ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
            {i < current ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cn(i !== current && 'hidden sm:inline')}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
