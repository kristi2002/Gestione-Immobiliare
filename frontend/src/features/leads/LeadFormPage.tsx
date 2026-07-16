import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import { useLead, useLeadAgents, useCreateLead, useUpdateLead, type LeadFormValues } from './api';

const INTEREST_OPTIONS = [
  { value: 'affitto', label: 'Affitto' },
  { value: 'acquisto', label: 'Acquisto' },
  { value: 'entrambi', label: 'Entrambi' },
];

const PROPERTY_TYPE_OPTIONS = [
  { value: 'appartamento', label: 'Appartamento' },
  { value: 'villa', label: 'Villa' },
  { value: 'ufficio', label: 'Ufficio' },
  { value: 'negozio', label: 'Negozio' },
  { value: 'box', label: 'Box' },
  { value: 'terreno', label: 'Terreno' },
  { value: 'altro', label: 'Altro' },
];

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nuovo' },
  { value: 'contacted', label: 'Contattato' },
  { value: 'interested', label: 'Interessato' },
  { value: 'negotiating', label: 'In trattativa' },
  { value: 'converted', label: 'Convertito' },
  { value: 'lost', label: 'Perso' },
];

const SOURCE_OPTIONS = [
  { value: 'telefono', label: 'Telefono' },
  { value: 'email', label: 'Email' },
  { value: 'web', label: 'Web' },
  { value: 'passaparola', label: 'Passaparola' },
  { value: 'social', label: 'Social' },
  { value: 'altro', label: 'Altro' },
];

const EMPTY: LeadFormValues = {
  name: '',
  surname: '',
  codice_fiscale: '',
  phone: '',
  email: '',
  interest_type: 'affitto',
  budget_min: '',
  budget_max: '',
  preferred_city: '',
  preferred_type: '',
  min_rooms: '',
  min_sqm: '',
  status: 'new',
  source: 'telefono',
  assigned_to: '',
  notes: '',
};

/** Lead create / edit — mirrors the legacy lead_edit.html field set exactly. */
export default function LeadFormPage() {
  const { id } = useParams<{ id: string }>();
  const leadId = id ? Number(id) : undefined;
  const isEdit = leadId != null;
  const navigate = useNavigate();

  const { data: lead, isLoading: leadLoading } = useLead(leadId);
  const { data: agents } = useLeadAgents();
  const create = useCreateLead();
  const update = useUpdateLead(leadId ?? 0);

  const [values, setValues] = useState<LeadFormValues>(EMPTY);
  const [error, setError] = useState('');
  // Hydrate the form from the fetched lead exactly once per mount — not on
  // every re-render of `lead` (e.g. a background refetchOnWindowFocus),
  // which would otherwise silently discard in-progress unsaved edits.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!lead || hydrated.current) return;
    hydrated.current = true;
    setValues({
      name: lead.name,
      surname: lead.surname ?? '',
      codice_fiscale: lead.codice_fiscale ?? '',
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      interest_type: lead.interest_type,
      budget_min: lead.budget_min ?? '',
      budget_max: lead.budget_max ?? '',
      preferred_city: lead.preferred_city ?? '',
      preferred_type: lead.preferred_type ?? '',
      min_rooms: lead.min_rooms != null ? String(lead.min_rooms) : '',
      min_sqm: lead.min_sqm ?? '',
      status: lead.status,
      source: lead.source,
      assigned_to: lead.assigned_to != null ? String(lead.assigned_to) : '',
      notes: lead.notes ?? '',
    });
  }, [lead]);

  function set<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) {
        await update.mutateAsync(values);
      } else {
        await create.mutateAsync(values);
      }
      navigate('/leads');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && leadLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Lead" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/leads">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? 'Modifica Lead' : 'Nuovo Lead'}
        subtitle="Dati del potenziale cliente, preferenze immobiliari e gestione."
      />

      <Card className="space-y-8 p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Anagrafica</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nome" required>
                <Input value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required />
              </Field>
              <Field label="Cognome" required>
                <Input value={values.surname} onChange={(e) => set('surname', e.target.value)} maxLength={100} required />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Codice Fiscale">
                <Input
                  value={values.codice_fiscale}
                  onChange={(e) => set('codice_fiscale', e.target.value.toUpperCase())}
                  maxLength={16}
                  placeholder="es. RSSMRA80A01H501U"
                  className="uppercase"
                />
              </Field>
              <Field label="Telefono">
                <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
              </Field>
              <Field label="Email">
                <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} maxLength={255} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Preferenze immobile</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Interesse">
                <Select
                  options={INTEREST_OPTIONS}
                  value={values.interest_type}
                  onChange={(e) => set('interest_type', e.target.value)}
                />
              </Field>
              <Field label="Budget min (€)">
                <Input type="number" min={0} step="0.01" value={values.budget_min} onChange={(e) => set('budget_min', e.target.value)} />
              </Field>
              <Field label="Budget max (€)">
                <Input type="number" min={0} step="0.01" value={values.budget_max} onChange={(e) => set('budget_max', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Città preferita">
                <Input value={values.preferred_city} onChange={(e) => set('preferred_city', e.target.value)} maxLength={100} />
              </Field>
              <Field label="Tipo immobile">
                <Select
                  options={PROPERTY_TYPE_OPTIONS}
                  placeholder="— Indifferente —"
                  value={values.preferred_type}
                  onChange={(e) => set('preferred_type', e.target.value)}
                />
              </Field>
              <Field label="Stanze min">
                <Input type="number" min={0} step="1" value={values.min_rooms} onChange={(e) => set('min_rooms', e.target.value)} />
              </Field>
            </div>
            <Field label="Metri quadri minimi" className="max-w-xs">
              <Input type="number" min={0} step="0.01" value={values.min_sqm} onChange={(e) => set('min_sqm', e.target.value)} />
            </Field>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Gestione</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Stato">
                <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
              </Field>
              <Field label="Fonte">
                <Select options={SOURCE_OPTIONS} value={values.source} onChange={(e) => set('source', e.target.value)} />
              </Field>
              <Field label="Agente assegnato">
                <Select
                  options={(agents ?? []).map((a) => ({ value: String(a.id), label: a.username }))}
                  placeholder="— Nessuno —"
                  value={values.assigned_to}
                  onChange={(e) => set('assigned_to', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Note">
              <textarea
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </Field>
          </fieldset>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/leads')}>
              Annulla
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Salvataggio…' : 'Salva'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
