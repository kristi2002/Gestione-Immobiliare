import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from './EmptyState';
import type { LucideIcon } from 'lucide-react';

export interface Column<T> {
  /** Stable key for the column. */
  id: string;
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Empty-state config shown when data is [] and not loading. */
  empty?: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode };
  skeletonRows?: number;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  data,
  isLoading,
  rowKey,
  onRowClick,
  empty,
  skeletonRows = 6,
}: DataTableProps<T>) {
  const showEmpty = !isLoading && data && data.length === 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            {columns.map((col) => (
              <th
                key={col.id}
                className={cn(
                  'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400',
                  alignClass[col.align ?? 'left'],
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-gray-100">
                {columns.map((col) => (
                  <td key={col.id} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-full max-w-[140px]" />
                  </td>
                ))}
              </tr>
            ))}

          {!isLoading &&
            data?.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-gray-100 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-[#F8F9FB]',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn('px-4 py-3.5 text-sm text-navy', alignClass[col.align ?? 'left'], col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {showEmpty && (
        <EmptyState
          icon={empty?.icon}
          title={empty?.title ?? 'Nessun dato'}
          description={empty?.description}
          action={empty?.action}
        />
      )}
    </div>
  );
}
