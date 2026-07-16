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
import { PAYMENT_METHOD_LABEL } from '@/features/finance-labels';
import { useTenantOptions } from '@/features/tenants/api';
import { usePayment, useCreatePayment, useUpdatePayment, type PaymentFormValues } from './api';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'In attesa' },
  { value: 'paid', label: 'Pagato' },
  { value: 'late', label: 'In ritardo' },
  { value: 'cancelled', label: 'Annullato' },
];

const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }));

const EMPTY: PaymentFormValues = {
  tenant_id: '',
  property_id: '',
  contract_id: '',
  amount: '',
  due_date: '',
  paid_date: '',
  status: 'pending',
  method: 'bonifico',
  notes: '',
};

export default function PaymentFormPage() {
  const { id } = useParams<{ id: string }>();
  const paymentId = id ? Number(id) : undefined;
  const isEdit = paymentId != null;
  const navigate = useNavigate();

  const { data: payment, isLoading } = usePayment(paymentId);
  const { data: tenants } = useTenantOptions();
  const create = useCreatePayment();
  const update = useUpdatePayment(paymentId ?? 0);

  const [values, setValues] = useState<PaymentFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!payment || hydrated.current) return;
    hydrated.current = true;
    setValues({
      tenant_id: String(payment.tenant_id),
      property_id: String(payment.property_id),
      contract_id: payment.contract_id != null ? String(payment.contract_id) : '',
      amount: payment.amount,
      due_date: payment.due_date,
      paid_date: payment.paid_date ?? '',
      status: payment.status,
      method: payment.method ?? 'bonifico',
      notes: payment.notes ?? '',
    });
  }, [payment]);

  function set<K extends keyof PaymentFormValues>(k: K, value: PaymentFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  // Selecting a tenant auto-fills their current property + contract, same as
  // the legacy form — still independently editable afterward.
  function onTenantChange(tenantId: string) {
    const tenant = (tenants ?? []).find((t) => String(t.id) === tenantId);
    setValues((v) => ({
      ...v,
      tenant_id: tenantId,
      property_id: tenant?.property_id != null ? String(tenant.property_id) : v.property_id,
      contract_id: tenant?.contract_id != null ? String(tenant.contract_id) : v.contract_id,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/payments');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Pagamento" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/payments">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? 'Modifica Pagamento' : 'Nuovo Pagamento'}
        subtitle="Per generare l'intero scadenzario di un contratto, usa Contratti → Genera Scadenzario invece di aggiungere pagamenti uno alla volta."
      />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <FormField label="Inquilino" required>
            <Select
              options={(tenants ?? []).map((t) => ({ value: String(t.id), label: `${t.name} ${t.surname ?? ''}` }))}
              placeholder="— Seleziona inquilino —"
              value={values.tenant_id}
              onChange={(e) => onTenantChange(e.target.value)}
              required
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Importo (€)" required>
              <Input type="number" min={0} step="0.01" value={values.amount} onChange={(e) => set('amount', e.target.value)} required />
            </FormField>
            <FormField label="Scadenza" required>
              <Input type="date" value={values.due_date} onChange={(e) => set('due_date', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
            </FormField>
            <FormField label="Metodo">
              <Select options={METHOD_OPTIONS} value={values.method} onChange={(e) => set('method', e.target.value)} />
            </FormField>
            <FormField label="Data pagamento">
              <Input type="date" value={values.paid_date} onChange={(e) => set('paid_date', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/payments')}>
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
