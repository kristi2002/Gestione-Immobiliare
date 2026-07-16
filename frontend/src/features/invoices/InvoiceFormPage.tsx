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
import { useClientOptions } from '@/features/clients/api';
import { useLeadOptions } from '@/features/leads/api';
import { leadName } from '@/features/leads/utils';
import { useInvoice, useCreateInvoice, useUpdateInvoice, type InvoiceFormValues } from './api';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Bozza' },
  { value: 'sent', label: 'Inviata' },
  { value: 'paid', label: 'Pagata' },
  { value: 'cancelled', label: 'Annullata' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: InvoiceFormValues = {
  client_id: '',
  lead_id: '',
  description: '',
  amount: '',
  vat_rate: '22',
  status: 'draft',
  issue_date: today(),
  due_date: '',
  paid_date: '',
  notes: '',
};

export default function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = id ? Number(id) : undefined;
  const isEdit = invoiceId != null;
  const navigate = useNavigate();

  const { data: invoice, isLoading } = useInvoice(invoiceId);
  const { data: clients } = useClientOptions();
  const { data: leads } = useLeadOptions();
  const create = useCreateInvoice();
  const update = useUpdateInvoice(invoiceId ?? 0);

  const [values, setValues] = useState<InvoiceFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!invoice || hydrated.current) return;
    hydrated.current = true;
    setValues({
      client_id: invoice.client_id != null ? String(invoice.client_id) : '',
      lead_id: invoice.lead_id != null ? String(invoice.lead_id) : '',
      description: invoice.description ?? '',
      amount: invoice.amount,
      vat_rate: invoice.vat_rate ?? '22',
      status: invoice.status,
      issue_date: invoice.issue_date ?? '',
      due_date: invoice.due_date ?? '',
      paid_date: invoice.paid_date ?? '',
      notes: '',
    });
  }, [invoice]);

  function set<K extends keyof InvoiceFormValues>(k: K, value: InvoiceFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/invoices');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Fattura" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/invoices">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? 'Modifica Fattura' : 'Nuova Fattura'}
        subtitle={isEdit ? undefined : 'Il numero fattura viene generato automaticamente al salvataggio.'}
      />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Proprietario">
              <Select
                options={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.surname} ${c.name}` }))}
                placeholder="— Nessuno —"
                value={values.client_id}
                onChange={(e) => set('client_id', e.target.value)}
              />
            </FormField>
            <FormField label="Lead">
              <Select
                options={(leads ?? []).map((l) => ({ value: String(l.id), label: leadName(l) }))}
                placeholder="— Nessuno —"
                value={values.lead_id}
                onChange={(e) => set('lead_id', e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Descrizione" required>
            <textarea
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              required
              className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Imponibile (€)" required>
              <Input type="number" min={0} step="0.01" value={values.amount} onChange={(e) => set('amount', e.target.value)} required />
            </FormField>
            <FormField label="IVA (%)">
              <Input type="number" min={0} step="0.01" value={values.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} />
            </FormField>
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Data emissione">
              <Input type="date" value={values.issue_date} onChange={(e) => set('issue_date', e.target.value)} />
            </FormField>
            <FormField label="Scadenza">
              <Input type="date" value={values.due_date} onChange={(e) => set('due_date', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/invoices')}>
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
