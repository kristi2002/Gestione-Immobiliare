import { UserRound } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentPortfolio } from './api';
import { AgentCard } from './components/AgentCard';

export default function AgentsPage() {
  const { data, isLoading, isError, refetch } = useAgentPortfolio();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Portafoglio Agenti" subtitle="Performance e attività del team" />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="mt-4 h-2 w-full" />
              <div className="mt-4 grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-16 rounded-xl" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={UserRound} title="Nessun agente" description="Non ci sono agenti attivi da mostrare." />
        </Card>
      )}
    </div>
  );
}
