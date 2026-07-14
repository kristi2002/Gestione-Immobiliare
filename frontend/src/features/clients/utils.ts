import type { Client } from '@/types/people';

export type PersonType = 'fisica' | 'giuridica';

/**
 * Infer whether a proprietario is a person or a company from their fiscal code.
 * Italian codice fiscale = 16 alphanumerics (person); partita IVA = 11 digits
 * (company). The clients table has no explicit type column, so we derive it.
 */
export function personType(client: Pick<Client, 'codice_fiscale'>): PersonType | null {
  const cf = (client.codice_fiscale ?? '').trim();
  if (!cf) return null;
  if (/^\d{11}$/.test(cf)) return 'giuridica';
  if (/^[A-Z0-9]{16}$/i.test(cf)) return 'fisica';
  return null;
}

export const PERSON_TYPE_LABEL: Record<PersonType, string> = {
  fisica: 'Persona Fisica',
  giuridica: 'Società',
};

export function fullName(p: { name: string; surname: string | null }): string {
  return [p.name, p.surname].filter(Boolean).join(' ').trim();
}
