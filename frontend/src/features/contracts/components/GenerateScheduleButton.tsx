import { CalendarPlus, Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import type { Contract } from '@/types/finance';
import { useGeneratePayments } from '../api';

/**
 * "Genera scadenzario" for a locazione contract. Shows inline result:
 * success (N payments created) or the backend error (e.g. duplicate guard).
 */
export function GenerateScheduleButton({ contract }: { contract: Contract }) {
  const gen = useGeneratePayments();

  if (contract.contract_type !== 'locazione') {
    return <span className="text-xs text-muted">—</span>;
  }

  if (gen.isSuccess) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
        <Check className="size-4" />
        {gen.data.payments_created} pagamenti creati
      </span>
    );
  }

  if (gen.isError) {
    const msg = gen.error instanceof ApiError ? gen.error.message : 'Errore';
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger" title={msg}>
        <AlertCircle className="size-4" />
        <span className="max-w-[16rem] truncate">{msg}</span>
      </span>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={gen.isPending}
      onClick={(e) => {
        e.stopPropagation();
        gen.mutate(contract.id);
      }}
    >
      {gen.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
      Genera scadenzario
    </Button>
  );
}
