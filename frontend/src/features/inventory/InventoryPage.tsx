import { Package, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Rating } from '@/components/common/Rating';
import type { Column } from '@/components/common/DataTable';
import { formatNumber } from '@/lib/format';

interface InventoryItem {
  id: number;
  item_name: string;
  category: string | null;
  quantity: number | null;
  condition_rating: number | null;
  property_address: string | null;
}

const columns: Column<InventoryItem>[] = [
  { id: 'item', header: 'Articolo', cell: (i) => <span className="font-medium text-navy">{i.item_name}</span> },
  { id: 'category', header: 'Categoria', cell: (i) => <span className="text-muted">{i.category ?? '—'}</span> },
  {
    id: 'property',
    header: 'Immobile',
    cell: (i) => (
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Home className="size-3.5" />
        {i.property_address ?? '—'}
      </span>
    ),
  },
  { id: 'qty', header: 'Q.tà', align: 'right', cell: (i) => (i.quantity != null ? formatNumber(i.quantity) : '—') },
  { id: 'condition', header: 'Condizione', cell: (i) => <Rating value={i.condition_rating} /> },
];

export default function InventoryPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<InventoryItem>
      title="Inventario"
      subtitle="Arredi e dotazioni degli immobili"
      endpoint="inventory.php"
      columns={columns}
      rowKey={(i) => i.id}
      itemLabel="articoli"
      searchPlaceholder="Cerca per articolo o immobile…"
      newTo="/inventory/new"
      newLabel="Nuovo Articolo"
      onRowClick={(i) => navigate(`/inventory/${i.id}/edit`)}
      empty={{ icon: Package, title: 'Inventario vuoto', description: 'Aggiungi il primo articolo.' }}
    />
  );
}
