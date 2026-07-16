import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FormField } from '@/components/common/FormField';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import { usePropertyOptions } from '@/features/properties/api';
import { useInsurancePolicy, useCreateInsurancePolicy, useUpdateInsurancePolicy, type InsuranceFormValues } from './api';

/** Source of truth is api/insurance.php's INSURANCE_TYPES — the legacy HTML
 * modal offers furto/responsabilita_civile/multirischio/vita, none of which
 * the backend actually accepts. Using the real enum here. */
const TYPE_OPTIONS = [
  { value: 'incendio', label: 'Incendio' },
  { value: 'responsabilita', label: 'Responsabilità civile' },
  { value: 'globale_fabbricato', label: 'Globale fabbricato' },
  { value: 'altro', label: 'Altro' },
];

const EMPTY: InsuranceFormValues = {
  property_id: '',
  insurer_name: '',
  policy_number: '',
  policy_type: 'incendio',
  premium_annual: '',
  start_date: '',
  end_date: '',
  notes: '',
};

export default function InsuranceFormPage() {
  const { id } = useParams<{ id: string }>();
  const policyId = id ? Number(id) : undefined;
  const isEdit = policyId != null;
  const navigate = useNavigate();

  const { data: policy, isLoading } = useInsurancePolicy(policyId);
  const { data: properties } = usePropertyOptions();
  const create = useCreateInsurancePolicy();
  const update = useUpdateInsurancePolicy(policyId ?? 0);

  const [values, setValues] = useState<InsuranceFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!policy || hydrated.current) return;
    hydrated.current = true;
    setValues({
      property_id: String(policy.property_id),
      insurer_name: policy.insurer_name,
      policy_number: policy.policy_number,
      policy_type: policy.policy_type,
      premium_annual: policy.premium_annual ?? '',
      start_date: policy.start_date ?? '',
      end_date: policy.end_date,
      notes: policy.notes ?? '',
    });
  }, [policy]);

  function set<K extends keyof InsuranceFormValues>(k: K, value: InsuranceFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/insurance');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Polizza" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/insurance">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Polizza' : 'Nuova Polizza'} subtitle="Assicurazioni immobili." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <FormField label="Immobile" required>
            <Select
              options={(properties ?? []).map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
              placeholder="— Seleziona immobile —"
              value={values.property_id}
              onChange={(e) => set('property_id', e.target.value)}
              required
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Compagnia assicurativa" required>
              <Input value={values.insurer_name} onChange={(e) => set('insurer_name', e.target.value)} maxLength={150} required />
            </FormField>
            <FormField label="Numero polizza" required>
              <Input value={values.policy_number} onChange={(e) => set('policy_number', e.target.value)} maxLength={100} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Tipo polizza" required>
              <Select options={TYPE_OPTIONS} value={values.policy_type} onChange={(e) => set('policy_type', e.target.value)} required />
            </FormField>
            <FormField label="Premio annuale (€)">
              <Input type="number" min={0} step="0.01" value={values.premium_annual} onChange={(e) => set('premium_annual', e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Data inizio">
              <Input type="date" value={values.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </FormField>
            <FormField label="Data scadenza" required>
              <Input type="date" value={values.end_date} onChange={(e) => set('end_date', e.target.value)} required />
            </FormField>
          </div>

          <FormField label="Note">
            <textarea
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </FormField>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/insurance')}>
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
