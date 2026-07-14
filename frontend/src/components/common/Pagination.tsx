import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Noun for the total count, e.g. "immobili". */
  itemLabel?: string;
}

export function Pagination({ page, pages, total, onPageChange, itemLabel = 'risultati' }: PaginationProps) {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <p className="text-sm text-muted">
        {total.toLocaleString('it-IT')} {itemLabel} · pagina {page} di {pages}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="size-4" />
          Precedente
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          Successiva
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
