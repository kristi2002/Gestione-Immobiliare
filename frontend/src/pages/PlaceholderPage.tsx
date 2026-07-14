import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';

interface PlaceholderPageProps {
  title: string;
  icon: LucideIcon;
}

/**
 * Temporary shell for views not yet migrated to React. Keeps the app fully
 * navigable during the phased migration — each of these gets replaced by a
 * real feature page in later phases.
 */
export default function PlaceholderPage({ title, icon }: PlaceholderPageProps) {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={icon}
          title="Sezione in arrivo"
          description={`La pagina "${title}" sarà disponibile in una prossima fase della migrazione a React.`}
        />
      </Card>
    </div>
  );
}
