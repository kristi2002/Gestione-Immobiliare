import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import type { PropertyMedia } from '@/types/property';

interface Props {
  media: PropertyMedia[] | undefined;
  isLoading: boolean;
  /** Fallback cover when media hasn't loaded or there are no photos. */
  fallbackCover?: string | null;
  alt: string;
}

export function PropertyGallery({ media, isLoading, fallbackCover, alt }: Props) {
  const photos = (media ?? []).filter((m) => (m.mime_type ?? '').startsWith('image/'));
  const sources: string[] =
    photos.length > 0
      ? photos.map((p) => p.url)
      : fallbackCover
        ? [fallbackCover]
        : [];

  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [media]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="aspect-[16/10] w-full rounded-2xl" />
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="size-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
        <div className="flex flex-col items-center gap-2">
          <ImageOff className="size-10" />
          <span className="text-sm text-muted">Nessuna foto disponibile</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl bg-slate-100">
        <ImageWithFallback
          src={sources[active]}
          alt={alt}
          loading="eager"
          className="size-full object-cover"
          fallbackClassName="size-full"
        />
      </div>
      {sources.length > 1 && (
        <div className="flex flex-wrap gap-3">
          {sources.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'size-20 overflow-hidden rounded-xl border-2 transition-colors',
                i === active ? 'border-primary' : 'border-transparent hover:border-border',
              )}
            >
              <ImageWithFallback
                src={src}
                alt={`${alt} ${i + 1}`}
                className="size-full object-cover"
                fallbackClassName="size-full"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
