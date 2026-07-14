import { formatCurrency } from '@/lib/format';
import type { PriceType, PropertyListItem, PropertyType } from '@/types/property';

export const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'appartamento', label: 'Appartamento' },
  { value: 'ufficio', label: 'Ufficio' },
  { value: 'villa', label: 'Villa' },
  { value: 'negozio', label: 'Negozio' },
];

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'available', label: 'Disponibile' },
  { value: 'rented', label: 'Affittato' },
  { value: 'sold', label: 'Venduto' },
];

export const PRICE_TYPE_OPTIONS: { value: PriceType; label: string }[] = [
  { value: 'vendita', label: 'Vendita' },
  { value: 'affitto', label: 'Affitto' },
];

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Ordina: predefinito' },
  { value: 'recent', label: 'Più recenti' },
  { value: 'price_desc', label: 'Prezzo: alto → basso' },
  { value: 'price_asc', label: 'Prezzo: basso → alto' },
  { value: 'sqm_desc', label: 'Superficie: grande → piccola' },
];

export function propertyTypeLabel(type: PropertyType | null): string {
  if (!type) return '—';
  return PROPERTY_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? capitalizeFirst(type);
}

/** "€ 320.000" for sales, "€ 900 /mese" for rentals. */
export function priceDisplay(p: Pick<PropertyListItem, 'price' | 'price_type'>): string {
  if (!p.price) return 'Prezzo n.d.';
  const amount = formatCurrency(p.price);
  return p.price_type === 'affitto' ? `${amount} /mese` : amount;
}

/** Some legacy rows store a garbled floor ("3??"). Strip non-printable noise. */
export function cleanFloor(floor: string | null): string | null {
  if (!floor) return null;
  const cleaned = floor.replace(/[^\p{L}\p{N}°º\s/-]/gu, '').trim();
  return cleaned || null;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
