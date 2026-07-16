import { Link } from 'react-router-dom';
import { Phone, Mail, Building2, UserRound, ExternalLink, MousePointerClick, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { initials, formatCurrency } from '@/lib/format';
import { useProperties } from '@/features/properties/api';
import { priceDisplay } from '@/features/properties/utils';
import { useClient } from '../api';
import { fullName, personType, PERSON_TYPE_LABEL } from '../utils';

export function ClientDetailPanel({ clientId }: { clientId: number | null }) {
  const { data: client, isLoading } = useClient(clientId);
  const { data: props } = useProperties({ client_id: clientId ?? undefined, limit: 5 });

  if (!clientId) {
    return (
      <Card className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-muted">
          <MousePointerClick className="size-7" />
        </div>
        <p className="text-card-title text-navy">Seleziona un proprietario</p>
        <p className="mt-1 max-w-[16rem] text-sm text-muted">
          Clicca una riga per vedere contatti e immobili collegati.
        </p>
      </Card>
    );
  }

  if (isLoading || !client) {
    return (
      <Card className="space-y-4">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const type = personType(client);

  return (
    <Card className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <Avatar className="size-20">
          <AvatarFallback className="bg-primary text-lg text-white">{initials(fullName(client))}</AvatarFallback>
        </Avatar>
        <h3 className="mt-3 text-lg font-bold text-navy">{fullName(client)}</h3>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {type && <Badge variant={type === 'fisica' ? 'primary' : 'secondary'}>{PERSON_TYPE_LABEL[type]}</Badge>}
          <StatusBadge status={client.status} />
        </div>
      </div>

      {/* Contatti */}
      <div className="mt-6">
        <p className="text-eyebrow mb-2">Contatti</p>
        <div className="space-y-2">
          <ContactRow icon={Phone} value={client.phone} />
          <ContactRow icon={Mail} value={client.email} />
          {client.codice_fiscale && <ContactRow icon={UserRound} value={client.codice_fiscale} />}
        </div>
      </div>

      {/* Immobili collegati */}
      <div className="mt-6 flex-1">
        <p className="text-eyebrow mb-2">
          Immobili collegati ({Number(client.property_count) || 0})
        </p>
        {props && props.items.length > 0 ? (
          <ul className="space-y-2">
            {props.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/properties/${p.id}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 p-2 transition-colors hover:bg-slate-50"
                >
                  <ImageWithFallback
                    src={p.cover_url}
                    alt={p.address}
                    className="size-10 rounded-lg object-cover"
                    fallbackClassName="size-10 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy">{p.address}</p>
                    <p className="truncate text-xs text-muted">{p.city}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-primary">
                    {p.price ? formatCurrency(p.price) : priceDisplay(p)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-4 text-sm text-muted">
            <Building2 className="size-4" />
            Nessun immobile collegato
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="outline" asChild>
          <Link to={`/clients/${client.id}/edit`}>
            <Pencil className="size-4" />
            Modifica
          </Link>
        </Button>
        <Button className="flex-1" asChild>
          <a href={`/index.php?view=client_profile&id=${client.id}`}>
            <ExternalLink className="size-4" />
            Visualizza Completo
          </a>
        </Button>
      </div>
    </Card>
  );
}

function ContactRow({ icon: Icon, value }: { icon: typeof Phone; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="truncate text-sm text-navy">{value}</span>
    </div>
  );
}
