import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtNumber } from '@/lib/utils';

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        {total === 0 ? '0 registros' : `${fmtNumber(page * pageSize + 1)}–${fmtNumber(Math.min(total, (page + 1) * pageSize))} de ${fmtNumber(total)}`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Página anterior"><ChevronLeft /></Button>
        <span className="px-2 tabular-nums">{page + 1} / {pages}</span>
        <Button variant="outline" size="icon" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"><ChevronRight /></Button>
      </div>
    </div>
  );
}
