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
import { useClientOptions } from '@/features/clients/api';
import { useSupplierOptions } from '@/features/suppliers/api';
import { useExpense, useCreateExpense, useUpdateExpense, type ExpenseFormValues } from './api';

const CATEGORY_OPTIONS = [
  { value: 'manutenzione', label: 'Manutenzione' },
  { value: 'utenze', label: 'Utenze' },
  { value: 'tasse', label: 'Tasse' },
  { value: 'assicurazione', label: 'Assicurazione' },
  { value: 'agenzia', label: 'Agenzia' },
  { value: 'altro', label: 'Altro' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: ExpenseFormValues = {
  category: 'altro',
  amount: '',
  description: '',
  expense_date: today(),
  property_id: '',
  client_id: '',
  supplier_id: '',
  receipt_url: '',
  notes: '',
};

export default function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>();
  const expenseId = id ? Number(id) : undefined;
  const isEdit = expenseId != null;
  const navigate = useNavigate();

  const { data: expense, isLoading } = useExpense(expenseId);
  const { data: properties } = usePropertyOptions();
  const { data: clients } = useClientOptions();
  const { data: suppliers } = useSupplierOptions();
  const create = useCreateExpense();
  const update = useUpdateExpense(expenseId ?? 0);

  const [values, setValues] = useState<ExpenseFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!expense || hydrated.current) return;
    hydrated.current = true;
    setValues({
      category: expense.category,
      amount: expense.amount,
      description: expense.description,
      expense_date: expense.expense_date,
      property_id: expense.property_id != null ? String(expense.property_id) : '',
      client_id: expense.client_id != null ? String(expense.client_id) : '',
      supplier_id: expense.supplier_id != null ? String(expense.supplier_id) : '',
      receipt_url: expense.receipt_url ?? '',
      notes: expense.notes ?? '',
    });
  }, [expense]);

  function set<K extends keyof ExpenseFormValues>(k: K, value: ExpenseFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/expenses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Spesa" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/expenses">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Spesa' : 'Nuova Spesa'} subtitle="Uscite di gestione immobili." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <FormField label="Descrizione" required>
            <Input value={values.description} onChange={(e) => set('description', e.target.value)} maxLength={500} required />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Categoria">
              <Select options={CATEGORY_OPTIONS} value={values.category} onChange={(e) => set('category', e.target.value)} />
            </FormField>
            <FormField label="Importo (€)" required>
              <Input type="number" min={0} step="0.01" value={values.amount} onChange={(e) => set('amount', e.target.value)} required />
            </FormField>
            <FormField label="Data" required>
              <Input type="date" value={values.expense_date} onChange={(e) => set('expense_date', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Immobile">
              <Select
                options={(properties ?? []).map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
                placeholder="— Nessuno —"
                value={values.property_id}
                onChange={(e) => set('property_id', e.target.value)}
              />
            </FormField>
            <FormField label="Proprietario">
              <Select
                options={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.surname} ${c.name}` }))}
                placeholder="— Nessuno —"
                value={values.client_id}
                onChange={(e) => set('client_id', e.target.value)}
              />
            </FormField>
            <FormField label="Fornitore">
              <Select
                options={(suppliers ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
                placeholder="— Nessuno —"
                value={values.supplier_id}
                onChange={(e) => set('supplier_id', e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Link ricevuta">
            <Input value={values.receipt_url} onChange={(e) => set('receipt_url', e.target.value)} maxLength={500} placeholder="https://…" />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/expenses')}>
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
