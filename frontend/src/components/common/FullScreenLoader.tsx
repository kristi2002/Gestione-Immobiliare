import { Loader2 } from 'lucide-react';

/** Centered spinner for route/auth transitions. */
export function FullScreenLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  );
}
