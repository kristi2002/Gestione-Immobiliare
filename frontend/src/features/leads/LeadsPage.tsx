import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, LayoutGrid, Table2, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { useUiStore, type LeadsViewMode } from '@/store/ui';
import { useLeadsList, useBoardLeads } from './api';
import { LeadKanban } from './components/LeadKanban';
import { LeadStatsBar } from './components/LeadStatsBar';
import { LeadsTable } from './components/LeadsTable';
import { STATUS_LABEL, INTEREST_LABEL } from './config';

const TOGGLE: { mode: LeadsViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { mode: 'kanban', icon: LayoutGrid, label: 'Pipeline' },
  { mode: 'table', icon: Table2, label: 'Tabella' },
];

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
const INTEREST_OPTIONS = Object.entries(INTEREST_LABEL).map(([value, label]) => ({ value, label }));

export default function LeadsPage() {
  const view = useUiStore((s) => s.leadsView);
  const setView = useUiStore((s) => s.setLeadsView);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [interest, setInterest] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  // Status filter only applies to the table — the Kanban columns already
  // partition by status, matching the legacy PHP toolbar's own behavior.
  const { data: tableData, isLoading: tableLoading } = useLeadsList({
    search: debouncedSearch,
    status,
    interest_type: interest,
  });
  const board = useBoardLeads({ search: debouncedSearch, interest_type: interest });

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Leads"
        subtitle="Pipeline di acquisizione clienti"
        actions={
          <>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-white p-1">
              {TOGGLE.map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg transition-colors',
                    view === mode ? 'bg-primary text-white' : 'text-muted hover:bg-slate-100',
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
            <Button asChild>
              <Link to="/leads/new">
                <Plus className="size-4" />
                Nuovo Lead
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome, telefono, email…"
            className="pl-11"
          />
        </div>
        {view === 'table' && (
          <Select
            options={STATUS_OPTIONS}
            placeholder="Attivi (esclusi convertiti)"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-auto min-w-[200px]"
          />
        )}
        <Select
          options={INTEREST_OPTIONS}
          placeholder="Tutti gli interessi"
          value={interest}
          onChange={(e) => setInterest(e.target.value)}
          className="w-auto min-w-[180px]"
        />
      </div>

      {view === 'kanban' ? (
        <LeadKanban board={board} />
      ) : (
        <LeadsTable items={tableData?.items} isLoading={tableLoading} />
      )}

      <LeadStatsBar />
    </div>
  );
}
