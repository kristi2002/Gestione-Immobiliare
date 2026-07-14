/**
 * Italian locale formatting helpers. All UI numbers, money and dates flow
 * through here so the whole product reads consistently (it-IT, EUR, 24h).
 */

const EUR = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const EUR_CENTS = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('it-IT');

/** €1.234 (no cents) — for large aggregate figures. */
export function formatCurrency(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return EUR.format(n);
}

/** €1.234,56 — for exact amounts (payments, invoices). */
export function formatCurrencyCents(value: number | string | null | undefined): string {
  return EUR_CENTS.format(toNumber(value));
}

/** 1.234 — thousands separated integer. */
export function formatNumber(value: number | string | null | undefined): string {
  return NUM.format(toNumber(value));
}

/** "14 lug 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "lunedì 14 luglio 2026" — long form for the dashboard greeting. */
export function formatDateLong(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "09:30" */
export function formatTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Capitalize the first letter (Intl weekday/month come back lowercase in it-IT). */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Initials from a full name — "Andrea Rossi" → "AR". */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
