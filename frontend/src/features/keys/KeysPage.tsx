import { Key, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate } from '@/lib/format';

interface PropertyKey {
  id: number;
  address: string | null;
  city: string | null;
  holder_name: string | null;
  holder_username: string | null;
  location: string | null;
  status: string;
  handed_at: string | null;
}

const columns: Column<PropertyKey>[] = [
  {
    id: 'property',
    header: 'Immobile',
    cell: (k) => (
      <span className="flex items-center gap-1.5 font-medium text-navy">
        <Home className="size-3.5 text-muted" />
        {k.address ?? '—'}
      </span>
    ),
  },
  { id: 'holder', header: 'Detentore', cell: (k) => k.holder_name ?? k.holder_username ?? 'In sede' },
  { id: 'location', header: 'Posizione', cell: (k) => <span className="text-muted">{k.location ?? '—'}</span> },
  {
    id: 'status',
    header: 'Stato',
    cell: (k) =>
      k.status === 'out' ? (
        <Badge variant="warning">Consegnata</Badge>
      ) : (
        <Badge variant="success">In sede</Badge>
      ),
  },
  { id: 'handed', header: 'Consegna', cell: (k) => formatDate(k.handed_at) },
];

export default function KeysPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<PropertyKey>
      title="Chiavi"
      subtitle="Registro consegna e rientro chiavi"
      endpoint="property_keys.php"
      columns={columns}
      rowKey={(k) => k.id}
      itemLabel="chiavi"
      searchPlaceholder="Cerca per immobile o detentore…"
      newTo="/keys/new"
      newLabel="Nuova Chiave"
      onRowClick={(k) => navigate(`/keys/${k.id}/edit`)}
      empty={{ icon: Key, title: 'Nessuna chiave registrata', description: 'Aggiungi la prima chiave.' }}
    />
  );
}
