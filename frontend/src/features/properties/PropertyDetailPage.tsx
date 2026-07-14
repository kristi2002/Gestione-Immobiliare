import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, MapPin, User, History } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState } from '@/components/common/ErrorState';
import { ApiError } from '@/lib/api/client';
import { formatCurrency, formatDate, initials } from '@/lib/format';
import { useProperty, usePropertyMedia } from './api';
import { PropertyGallery } from './components/PropertyGallery';
import { PropertyFacts } from './components/PropertyFacts';
import { propertyTypeLabel } from './utils';

export default function PropertyDetailPage() {
  const { id } = useParams();
  const propertyId = Number(id);
  const { data: property, isLoading, isError, error, refetch } = useProperty(propertyId);
  const { data: media, isLoading: mediaLoading } = usePropertyMedia(propertyId);

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <div className="animate-fade-in space-y-5">
      <Link to="/properties" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-navy">
        <ArrowLeft className="size-4" />
        Torna agli immobili
      </Link>

      {isError ? (
        <Card>
          <ErrorState
            title={notFound ? 'Immobile non trovato' : undefined}
            message={notFound ? "L'immobile richiesto non esiste o è stato archiviato." : undefined}
            onRetry={notFound ? undefined : () => refetch()}
          />
        </Card>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {isLoading ? (
                <Skeleton className="h-8 w-72" />
              ) : (
                <h1 className="text-page-title text-navy">{property!.address}</h1>
              )}
              <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                <MapPin className="size-4" />
                {isLoading ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  <span>
                    {[property!.city, property!.province, propertyTypeLabel(property!.property_type)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isLoading && property && <StatusBadge status={property.status} />}
              <Button asChild>
                <a href={`/index.php?view=property_edit&id=${propertyId}`}>
                  <Pencil className="size-4" />
                  Modifica
                </a>
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <PropertyGallery
                media={media}
                isLoading={mediaLoading || isLoading}
                fallbackCover={property?.cover_url}
                alt={property?.address ?? 'Immobile'}
              />

              {(isLoading || property?.description) && (
                <Card>
                  <CardTitle className="mb-2">Descrizione</CardTitle>
                  {isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-4/6" />
                    </div>
                  ) : (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
                      {property!.description}
                    </p>
                  )}
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-5">
              {isLoading ? (
                <Card>
                  <Skeleton className="h-6 w-32" />
                  <div className="mt-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                </Card>
              ) : (
                property && <PropertyFacts property={property} />
              )}

              {/* Owner */}
              {!isLoading && property && (
                <Card>
                  <CardTitle className="mb-3">Proprietario</CardTitle>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>
                        {initials(`${property.client_name ?? ''} ${property.client_surname ?? ''}`)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy">
                        {[property.client_name, property.client_surname].filter(Boolean).join(' ') || '—'}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <User className="size-3" />
                        Proprietario
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Price history */}
              {!isLoading && property && property.price_history.length > 0 && (
                <Card>
                  <CardTitle className="mb-3 flex items-center gap-2">
                    <History className="size-4 text-muted" />
                    Storico prezzi
                  </CardTitle>
                  <ul className="space-y-2">
                    {property.price_history.map((h, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{formatDate(h.changed_at)}</span>
                        <span className="font-medium text-navy">
                          {h.old_price ? formatCurrency(h.old_price) : '—'} →{' '}
                          {h.new_price ? formatCurrency(h.new_price) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
