import { Plus, LayoutGrid, Table2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUiStore, type LeadsViewMode } from '@/store/ui';
import { useLeadsList } from './api';
import { LeadKanban } from './components/LeadKanban';
import { LeadStatsBar } from './components/LeadStatsBar';
import { LeadsTable } from './components/LeadsTable';

const TOGGLE: { mode: LeadsViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { mode: 'kanban', icon: LayoutGrid, label: 'Pipeline' },
  { mode: 'table', icon: Table2, label: 'Tabella' },
];

export default function LeadsPage() {
  const view = useUiStore((s) => s.leadsView);
  const setView = useUiStore((s) => s.setLeadsView);
  const { data: tableData, isLoading: tableLoading } = useLeadsList({});

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
              <a href="/index.php?view=lead_edit">
                <Plus className="size-4" />
                Nuovo Lead
              </a>
            </Button>
          </>
        }
      />

      {view === 'kanban' ? <LeadKanban /> : <LeadsTable items={tableData?.items} isLoading={tableLoading} />}

      <LeadStatsBar />
    </div>
  );
}
