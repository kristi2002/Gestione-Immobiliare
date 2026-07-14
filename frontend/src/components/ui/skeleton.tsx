import { cn } from '@/lib/utils';

/** Shimmer placeholder used for all loading states. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} {...props} />;
}

export { Skeleton };
