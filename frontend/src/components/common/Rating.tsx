import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Compact star rating out of `max` (default 5). */
export function Rating({ value, max = 5 }: { value: number | string | null | undefined; max?: number }) {
  const n = value == null ? 0 : Math.round(Number(value));
  if (!n) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${n}/${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn('size-3.5', i < n ? 'fill-warning text-warning' : 'text-slate-200')}
        />
      ))}
    </span>
  );
}
