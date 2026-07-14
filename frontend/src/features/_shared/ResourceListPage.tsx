import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/DataTable';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useResourceList } from './useResourceList';

interface StatusFilter {
  param: string;
  placeholder: string;
  options: SelectOption[];
}

interface ResourceListPageProps<T> {
  title: string;
  subtitle?: string;
  endpoint: string;
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  itemLabel: string;
  empty: { icon?: LucideIcon; title: string; description?: string };
  /** New-record link (legacy editor). */
  newHref?: string;
  newLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Optional single dropdown filter. */
  statusFilter?: StatusFilter;
  /** Extra always-on query params. */
  params?: Record<string, string | number>;
  onRowClick?: (row: T) => void;
  /** Right-aligned header extras (e.g. view toggles). */
  headerActions?: ReactNode;
}

/**
 * Standard resource list page: header + optional search/filter + paginated
 * DataTable. Powers the many CRUD list screens with a small per-resource config.
 */
export function ResourceListPage<T>({
  title,
  subtitle,
  endpoint,
  columns,
  rowKey,
  itemLabel,
  empty,
  newHref,
  newLabel,
  searchable = true,
  searchPlaceholder = 'Cerca…',
  statusFilter,
  params,
  onRowClick,
  headerActions,
}: ResourceListPageProps<T>) {
  const [search, setSearch] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 350);

  const queryParams = useMemo(
    () => ({
      ...params,
      search: searchable ? debounced : undefined,
      ...(statusFilter ? { [statusFilter.param]: filterValue } : {}),
      page,
      limit: 25,
    }),
    [params, searchable, debounced, statusFilter, filterValue, page],
  );

  const { data, isLoading, isError, refetch } = useResourceList<T>(endpoint, queryParams);

  useEffect(() => setPage(1), [debounced, filterValue]);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {headerActions}
            {newHref && (
              <Button asChild>
                <a href={newHref}>
                  <Plus className="size-4" />
                  {newLabel ?? 'Nuovo'}
                </a>
              </Button>
            )}
          </>
        }
      />

      {(searchable || statusFilter) && (
        <div className="flex flex-wrap gap-3">
          {searchable && (
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-11"
              />
            </div>
          )}
          {statusFilter && (
            <Select
              className="w-52"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              options={statusFilter.options}
              placeholder={statusFilter.placeholder}
            />
          )}
        </div>
      )}

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <Card className="p-2">
          <DataTable
            columns={columns}
            data={data?.items}
            isLoading={isLoading}
            rowKey={rowKey}
            skeletonRows={8}
            empty={empty}
            onRowClick={onRowClick}
          />
        </Card>
      )}

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel={itemLabel} />
      )}
    </div>
  );
}
