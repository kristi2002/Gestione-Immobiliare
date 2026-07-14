import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Compass className="size-8" />
      </div>
      <p className="text-page-title text-navy">Pagina non trovata</p>
      <p className="mt-1 text-sm text-muted">La pagina che cerchi non esiste o è stata spostata.</p>
      <Button asChild className="mt-6">
        <Link to="/">Torna alla Dashboard</Link>
      </Button>
    </div>
  );
}
