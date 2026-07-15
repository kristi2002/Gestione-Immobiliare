import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Facebook,
  Image as ImageIcon,
  Instagram,
  Linkedin,
  Music2,
  Plus,
  Send,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { capitalize } from '@/lib/format';
import {
  useCreatePost,
  usePublishPost,
  useSocialPosts,
  useSocialSettings,
  type SocialPlatform,
  type SocialPost,
  type SocialSettings,
} from './api';

// ---------------------------------------------------------------------------
// Platform presentation
// ---------------------------------------------------------------------------

type DisplayPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok';

interface PlatformMeta {
  key: DisplayPlatform;
  label: string;
  icon: LucideIcon;
  /** Brand tint used for icon chips + calendar dots. */
  chip: string;
  dot: string;
}

const PLATFORMS: PlatformMeta[] = [
  { key: 'facebook', label: 'Facebook', icon: Facebook, chip: 'bg-[#1877F2]', dot: 'bg-[#1877F2]' },
  { key: 'instagram', label: 'Instagram', icon: Instagram, chip: 'bg-[#E1306C]', dot: 'bg-[#E1306C]' },
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, chip: 'bg-[#0A66C2]', dot: 'bg-[#0A66C2]' },
  { key: 'tiktok', label: 'TikTok', icon: Music2, chip: 'bg-navy', dot: 'bg-navy' },
];

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** Which display platforms a post targets (backend uses 'both'). */
function postPlatforms(p: SocialPlatform): DisplayPlatform[] {
  if (p === 'both') return ['facebook', 'instagram'];
  return [p];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Connected accounts are derived from Meta settings; the rest stay "Non connesso". */
function accountState(settings: SocialSettings | undefined) {
  return {
    facebook: {
      connected: !!settings?.is_connected,
      handle: settings?.facebook_page_id ?? null,
    },
    instagram: {
      connected: !!settings?.has_instagram,
      handle: settings?.instagram_account_id ?? null,
    },
    linkedin: { connected: false, handle: null },
    tiktok: { connected: false, handle: null },
  } as const;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SocialPage() {
  const posts = useSocialPosts();
  const settings = useSocialSettings();

  const accounts = accountState(settings.data);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Social Media"
        subtitle="Pianificazione e pubblicazione contenuti immobiliari"
        actions={
          <Button variant="primary">
            <Plus className="size-4" /> Crea Post
          </Button>
        }
      />

      {/* Connected-account cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {PLATFORMS.map((p) => {
          const state = accounts[p.key];
          const Icon = p.icon;
          return (
            <Card key={p.key} className="p-5">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex size-11 shrink-0 items-center justify-center rounded-full text-white',
                    p.chip,
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy">
                    {state.handle ?? p.label}
                  </p>
                  {state.connected ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="success">Connesso</Badge>
                      <span className="text-xs text-muted">{p.label}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">Non connesso</span>
                      <Button variant="primary" size="sm">
                        Connetti
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ContentCalendar
            posts={posts.data?.items}
            isLoading={posts.isLoading}
            isError={posts.isError}
            onRetry={() => posts.refetch()}
          />
        </div>
        <div className="space-y-6">
          <ComposerCard accounts={accounts} />
          <WeeklyStatsCard posts={posts.data?.items ?? []} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content calendar (6-week month grid, platform dots per day)
// ---------------------------------------------------------------------------

interface ContentCalendarProps {
  posts: SocialPost[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function ContentCalendar({ posts, isLoading, isError, onRetry }: ContentCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of posts ?? []) {
      const when = post.published_at ?? post.scheduled_at;
      if (!when) continue;
      const key = when.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }, [posts]);

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const offset = (first.getDay() + 6) % 7; // Mon = 0
    const start = new Date(cursor.year, cursor.month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);

  const monthLabel = capitalize(
    new Date(cursor.year, cursor.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
  );
  const todayKey = dayKey(new Date());

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-card-title text-navy">Calendario Contenuti</h3>
          <p className="mt-0.5 text-sm text-muted">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Mese precedente">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Mese successivo">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {isError ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-2 text-center text-eyebrow">
              {w}
            </div>
          ))}
          {isLoading
            ? Array.from({ length: 42 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
            : cells.map((d) => {
                const key = dayKey(d);
                const inMonth = d.getMonth() === cursor.month;
                const dayPosts = byDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex min-h-20 flex-col gap-1 rounded-lg border p-1.5',
                      inMonth ? 'border-gray-100 bg-white' : 'border-transparent bg-slate-50/50',
                      key === todayKey && 'ring-2 ring-primary/40',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        inMonth ? 'text-navy' : 'text-slate-300',
                        key === todayKey && 'text-primary',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {dayPosts.length > 0 && (
                      <div className="mt-auto flex flex-wrap gap-1">
                        {dayPosts.slice(0, 4).map((post) =>
                          postPlatforms(post.platform).map((pk) => {
                            const meta = PLATFORMS.find((m) => m.key === pk)!;
                            const Icon = meta.icon;
                            return (
                              <span
                                key={`${post.id}-${pk}`}
                                className={cn(
                                  'flex size-4 items-center justify-center rounded-full text-white',
                                  meta.dot,
                                )}
                                title={`${meta.label} · ${post.caption}`}
                              >
                                <Icon className="size-2.5" />
                              </span>
                            );
                          }),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

interface ComposerCardProps {
  accounts: ReturnType<typeof accountState>;
}

function ComposerCard({ accounts }: ComposerCardProps) {
  const [selected, setSelected] = useState<Set<'facebook' | 'instagram'>>(new Set(['facebook']));
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const createPost = useCreatePost();
  const publishPost = usePublishPost();
  const busy = createPost.isPending || publishPost.isPending;

  const toggle = (key: 'facebook' | 'instagram') =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add(key); // keep at least one
      return next;
    });

  const platform: SocialPlatform =
    selected.has('facebook') && selected.has('instagram')
      ? 'both'
      : selected.has('instagram')
        ? 'instagram'
        : 'facebook';

  const captionMissing = caption.trim() === '';

  const reset = () => {
    setCaption('');
    setScheduledAt('');
  };

  const handleSchedule = () => {
    if (captionMissing || !scheduledAt) return;
    createPost.mutate(
      { caption: caption.trim(), platform, scheduled_at: scheduledAt, status: 'scheduled' },
      { onSuccess: reset },
    );
  };

  const handlePublishNow = () => {
    if (captionMissing) return;
    const now = new Date();
    const stamp = `${dayKey(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    createPost.mutate(
      { caption: caption.trim(), platform, scheduled_at: stamp, status: 'scheduled' },
      {
        onSuccess: (post) => {
          publishPost.mutate(post.id, { onSuccess: reset });
        },
      },
    );
  };

  const errorMsg =
    (createPost.error as Error | null)?.message ?? (publishPost.error as Error | null)?.message ?? null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-card-title text-navy">Nuovo Post</h3>
        <div className="flex items-center gap-1.5">
          {(['facebook', 'instagram'] as const).map((key) => {
            const meta = PLATFORMS.find((m) => m.key === key)!;
            const Icon = meta.icon;
            const active = selected.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                aria-label={meta.label}
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg border transition-colors',
                  active
                    ? cn(meta.chip, 'border-transparent text-white')
                    : 'border-border bg-white text-muted hover:bg-slate-50',
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        rows={3}
        placeholder="Scopri questo bellissimo appartamento…"
        className={cn(
          'w-full resize-none rounded-xl border border-border bg-white px-4 py-3 text-sm text-navy',
          'placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
        )}
      />

      {/* Image placeholder */}
      <div className="mt-3 flex h-28 items-center justify-center rounded-xl border border-dashed border-border bg-slate-50 text-slate-300">
        <ImageIcon className="size-6" />
      </div>

      <label className="mt-3 block text-xs font-medium text-muted" htmlFor="social-schedule">
        Data pianificazione
      </label>
      <input
        id="social-schedule"
        type="datetime-local"
        value={scheduledAt}
        onChange={(e) => setScheduledAt(e.target.value)}
        className={cn(
          'mt-1 h-11 w-full rounded-xl border border-border bg-white px-4 text-sm text-navy',
          'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
        )}
      />

      {errorMsg && <p className="mt-3 text-xs text-danger">{errorMsg}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          className="bg-success text-white hover:bg-success/90"
          disabled={busy || captionMissing}
          onClick={handlePublishNow}
        >
          <Send className="size-4" /> Pubblica Ora
        </Button>
        <Button variant="primary" disabled={busy || captionMissing || !scheduledAt} onClick={handleSchedule}>
          <CalendarClock className="size-4" /> Pianifica
        </Button>
      </div>

      {!accounts.facebook.connected && !accounts.instagram.connected && (
        <p className="mt-3 text-xs text-muted">
          Nessun account collegato — la pubblicazione sarà simulata (modalità demo).
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Weekly stats
// ---------------------------------------------------------------------------

interface StatFigure {
  label: string;
  value: string;
  fill: number; // 0..1 bar fill
  bar: string;
}

function WeeklyStatsCard({ posts }: { posts: SocialPost[] }) {
  // Posts scheduled/published in the current ISO-ish week (Mon–Sun).
  const weekCount = useMemo(() => {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return posts.filter((p) => {
      const when = p.published_at ?? p.scheduled_at;
      if (!when) return false;
      const d = new Date(when.replace(' ', 'T'));
      return d >= start && d < end;
    }).length;
  }, [posts]);

  // Reach/engagement/follower analytics are not exposed by the API (demo/dev mode) → placeholders.
  const figures: StatFigure[] = [
    { label: 'Copertura', value: '—', fill: 0.15, bar: 'bg-primary' },
    { label: 'Interazione', value: '—', fill: 0.15, bar: 'bg-[#E1306C]' },
    { label: 'Nuovi Follower', value: '0', fill: 0.15, bar: 'bg-secondary' },
  ];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-card-title text-navy">Statistiche Settimana</h3>
        <Badge variant="neutral">{weekCount} post</Badge>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {figures.map((f) => (
          <div key={f.label}>
            <p className="text-lg font-bold text-navy">{f.value}</p>
            <p className="text-xs text-muted">{f.label}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full', f.bar)} style={{ width: `${Math.round(f.fill * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        Le statistiche complete saranno disponibili dopo il collegamento degli account.
      </p>
    </Card>
  );
}
