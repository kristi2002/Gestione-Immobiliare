import { FileText, Download, Home, User } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { mediaSrc } from '@/lib/media';
import { formatDate } from '@/lib/format';

interface DocumentRow {
  id: number;
  doc_type: string | null;
  title: string | null;
  original_name: string | null;
  created_at: string;
  client_name: string | null;
  client_surname: string | null;
  property_address: string | null;
  download_url: string | null;
}

function related(d: DocumentRow) {
  const client = [d.client_name, d.client_surname].filter(Boolean).join(' ');
  if (client) return { icon: User, text: client };
  if (d.property_address) return { icon: Home, text: d.property_address };
  return null;
}

const columns: Column<DocumentRow>[] = [
  {
    id: 'title',
    header: 'Documento',
    cell: (d) => (
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-navy">{d.title ?? d.original_name ?? 'Documento'}</p>
          {d.original_name && d.title && <p className="truncate text-xs text-muted">{d.original_name}</p>}
        </div>
      </div>
    ),
  },
  { id: 'type', header: 'Tipo', cell: (d) => (d.doc_type ? <Badge variant="neutral">{d.doc_type}</Badge> : '—') },
  {
    id: 'related',
    header: 'Collegato a',
    cell: (d) => {
      const r = related(d);
      if (!r) return <span className="text-muted">—</span>;
      const Icon = r.icon;
      return (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Icon className="size-3.5" />
          <span className="truncate">{r.text}</span>
        </span>
      );
    },
  },
  { id: 'date', header: 'Data', cell: (d) => formatDate(d.created_at) },
  {
    id: 'actions',
    header: '',
    align: 'right',
    cell: (d) =>
      d.download_url ? (
        <Button variant="ghost" size="icon" asChild>
          <a href={mediaSrc(d.download_url) ?? '#'} target="_blank" rel="noopener" aria-label="Scarica">
            <Download className="size-4" />
          </a>
        </Button>
      ) : null,
  },
];

export default function DocumentsPage() {
  return (
    <ResourceListPage<DocumentRow>
      title="Documenti"
      subtitle="Archivio documenti e contratti"
      endpoint="documents.php"
      columns={columns}
      rowKey={(d) => d.id}
      itemLabel="documenti"
      searchPlaceholder="Cerca per titolo o tipo…"
      newHref="/index.php?view=documents"
      newLabel="Nuovo Documento"
      empty={{ icon: FileText, title: 'Nessun documento', description: 'Carica il primo documento.' }}
    />
  );
}
