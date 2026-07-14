import type { ContractType } from '@/types/finance';

export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  locazione: 'Locazione',
  compravendita: 'Compravendita',
  preliminare: 'Preliminare',
  mandato: 'Mandato',
  altro: 'Altro',
};

export const COMMISSION_TYPE_LABEL: Record<string, string> = {
  vendita: 'Vendita',
  locazione: 'Locazione',
  affitto: 'Affitto',
  gestione: 'Gestione',
  altro: 'Altro',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bonifico: 'Bonifico',
  sdd: 'SDD',
  mav: 'MAV',
  contanti: 'Contanti',
  assegno: 'Assegno',
  pos: 'POS',
  stripe: 'Stripe',
  altro: 'Altro',
};

export function contractTypeLabel(t: ContractType | string | null): string {
  return t ? (CONTRACT_TYPE_LABEL[t] ?? t) : '—';
}
