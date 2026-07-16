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
import { useTenant, useCreateTenant, useUpdateTenant, type TenantFormValues } from './api';

const EMPTY: TenantFormValues = {
  name: '',
  surname: '',
  email: '',
  phone: '',
  property_id: '',
  lease_start: '',
  lease_end: '',
  monthly_rent: '',
  iban: '',
  sdd_mandate_ref: '',
  sdd_mandate_date: '',
  portal_password: '',
  notes: '',
};

export default function TenantFormPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = id ? Number(id) : undefined;
  const isEdit = tenantId != null;
  const navigate = useNavigate();

  const { data: tenant, isLoading } = useTenant(tenantId);
  const { data: properties } = usePropertyOptions();
  const create = useCreateTenant();
  const update = useUpdateTenant(tenantId ?? 0);

  const [values, setValues] = useState<TenantFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!tenant || hydrated.current) return;
    hydrated.current = true;
    setValues({
      name: tenant.name,
      surname: tenant.surname ?? '',
      email: tenant.email ?? '',
      phone: tenant.phone ?? '',
      property_id: tenant.property_id != null ? String(tenant.property_id) : '',
      lease_start: tenant.lease_start ?? '',
      lease_end: tenant.lease_end ?? '',
      monthly_rent: tenant.monthly_rent ?? '',
      iban: tenant.iban ?? '',
      sdd_mandate_ref: tenant.sdd_mandate_ref ?? '',
      sdd_mandate_date: tenant.sdd_mandate_date ?? '',
      portal_password: '',
      notes: '',
    });
  }, [tenant]);

  function set<K extends keyof TenantFormValues>(k: K, value: TenantFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  // Excluding archived properties client-side, matching the legacy JS — the
  // backend doesn't filter this list server-side.
  const availableProperties = (properties ?? []).filter((p) => p.status !== 'archived');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/tenants');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Inquilino" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/tenants">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? 'Modifica Inquilino' : 'Nuovo Inquilino'}
        subtitle="Salvando si crea o aggiorna anche il contratto di locazione collegato."
      />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Nome" required>
              <Input value={values.name} onChange={(e) => set('name', e.target.value)} required />
            </FormField>
            <FormField label="Cognome" required>
              <Input value={values.surname} onChange={(e) => set('surname', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Email" required>
              <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} required />
            </FormField>
            <FormField label="Telefono">
              <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} />
            </FormField>
          </div>

          <FormField label="Immobile" required>
            <Select
              options={availableProperties.map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
              placeholder="— Seleziona immobile —"
              value={values.property_id}
              onChange={(e) => set('property_id', e.target.value)}
              required
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Inizio locazione">
              <Input type="date" value={values.lease_start} onChange={(e) => set('lease_start', e.target.value)} />
            </FormField>
            <FormField label="Fine locazione">
              <Input type="date" value={values.lease_end} onChange={(e) => set('lease_end', e.target.value)} />
            </FormField>
            <FormField label="Canone mensile (€)">
              <Input type="number" min={0} step="0.01" value={values.monthly_rent} onChange={(e) => set('monthly_rent', e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="IBAN">
              <Input value={values.iban} onChange={(e) => set('iban', e.target.value)} maxLength={34} placeholder="IT.." />
            </FormField>
            <FormField label="Rif. mandato SDD">
              <Input value={values.sdd_mandate_ref} onChange={(e) => set('sdd_mandate_ref', e.target.value)} maxLength={35} />
            </FormField>
            <FormField label="Data mandato SDD">
              <Input type="date" value={values.sdd_mandate_date} onChange={(e) => set('sdd_mandate_date', e.target.value)} />
            </FormField>
          </div>

          <FormField label="Password portale">
            <Input
              type="password"
              value={values.portal_password}
              onChange={(e) => set('portal_password', e.target.value)}
              minLength={8}
              placeholder={isEdit ? 'Lascia vuoto per non modificarla' : 'Opzionale, minimo 8 caratteri'}
            />
          </FormField>

          <FormField label="Note">
            <textarea
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </FormField>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/tenants')}>
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
