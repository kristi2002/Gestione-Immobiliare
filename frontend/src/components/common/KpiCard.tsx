import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from './Sparkline';

export type KpiAccent = 'primary' | 'secondary' | 'success' | 'warning';

const ACCENT: Record<KpiAccent, { bar: string; iconBg: string; iconText: string; spark: string }> = {
  primary: { bar: 'bg-primary', iconBg: 'bg-primary/10', iconText: 'text-primary', spark: '#0B3D91' },
  secondary: { bar: 'bg-secondary', iconBg: 'bg-secondary/10', iconText: 'text-secondary', spark: '#4A90D9' },
  success: { bar: 'bg-success', iconBg: 'bg-success/10', iconText: 'text-success', spark: '#22C55E' },
  warning: { bar: 'bg-warning', iconBg: 'bg-warning/10', iconText: 'text-warning', spark: '#F97316' },
};

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: KpiAccent;
  /** e.g. "in portafoglio" — small caption under the value. */
  caption?: string;
  trend?: { value: number; label?: string };
  sparkData?: number[];
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = 'primary',
  caption,
  trend,
  sparkData,
}: KpiCardProps) {
  const a = ACCENT[accent];
  const trendUp = (trend?.value ?? 0) >= 0;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-card transition-shadow hover:shadow-card-hover">
      {/* left-top colored border (3px) */}
      <span className={cn('absolute inset-x-0 top-0 h-[3px]', a.bar)} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-eyebrow">{label}</p>
          <p className="mt-2 text-3xl font-bold leading-none text-navy">{value}</p>
        </div>
        <div className={cn('flex size-11 items-center justify-center rounded-full', a.iconBg, a.iconText)}>
          <Icon className="size-5" />
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                trendUp ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
              )}
            >
              {trendUp ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {trendUp ? '+' : ''}
              {trend.value}%
            </span>
          )}
          {caption && <span className="text-xs text-muted">{caption}</span>}
        </div>
        {sparkData && sparkData.length > 1 && <Sparkline data={sparkData} color={a.spark} />}
      </div>
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-card">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="size-11 rounded-full" />
      </div>
      <Skeleton className="mt-5 h-4 w-24" />
    </div>
  );
}
