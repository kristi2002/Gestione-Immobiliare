import { useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediaSrc } from '@/lib/media';

interface ImageWithFallbackProps {
  /** Raw backend path or URL; resolved via mediaSrc. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Classes for the fallback box (should match the image footprint). */
  fallbackClassName?: string;
  fallback?: ReactNode;
  loading?: 'lazy' | 'eager';
}

/**
 * Renders an image, falling back to a placeholder both when there is no source
 * AND when the source fails to load (404 / broken). Many seeded media paths
 * point at files that don't exist on disk, so the onError path matters.
 */
export function ImageWithFallback({
  src,
  alt,
  className,
  fallbackClassName,
  fallback,
  loading = 'lazy',
}: ImageWithFallbackProps) {
  const resolved = mediaSrc(src);
  const [failed, setFailed] = useState(false);

  if (!resolved || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-slate-100 text-slate-300',
          fallbackClassName ?? className,
        )}
        aria-label={alt}
        role="img"
      >
        {fallback ?? <ImageOff className="size-5" />}
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
