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
import { COMMISSION_TYPE_LABEL } from '@/features/finance-labels';
import { useLeadAgents } from '@/features/leads/api';
import { useCommission, useCreateCommission, useUpdateCommission, type CommissionFormValues } from './api';

const TYPE_OPTIONS = Object.entries(COMMISSION_TYPE_LABEL).map(([value, label]) => ({ value, label }));

const EMPTY: CommissionFormValues = {
  admin_user_id: '',
  commission_type: 'vendita',
  amount: '',
  percentage: '',
  due_date: '',
  contract_id: '',
  notes: '',
};

export default function CommissionFormPage() {
  const { id } = useParams<{ id: string }>();
  const commissionId = id ? Number(id) : undefined;
  const isEdit = commissionId != null;
  const navigate = useNavigate();

  const { data: commission, isLoading } = useCommission(commissionId);
  const { data: agents } = useLeadAgents();
  const create = useCreateCommission();
  const update = useUpdateCommission(commissionId ?? 0);

  const [values, setValues] = useState<CommissionFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!commission || hydrated.current) return;
    hydrated.current = true;
    setValues({
      admin_user_id: String(commission.admin_user_id),
      commission_type: commission.commission_type,
      amount: commission.amount,
      percentage: commission.percentage ?? '',
      due_date: commission.due_date ?? '',
      contract_id: commission.contract_id != null ? String(commission.contract_id) : '',
      notes: commission.notes ?? '',
    });
  }, [commission]);

  function set<K extends keyof CommissionFormValues>(k: K, value: CommissionFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/commissions');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Provvigione" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/commissions">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Provvigione' : 'Nuova Provvigione'} subtitle="Compensi agenti." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Agente" required>
              <Select
                options={(agents ?? []).map((a) => ({ value: String(a.id), label: a.username }))}
                placeholder="— Seleziona agente —"
                value={values.admin_user_id}
                onChange={(e) => set('admin_user_id', e.target.value)}
                required
              />
            </FormField>
            <FormField label="Tipo" required>
              <Select options={TYPE_OPTIONS} value={values.commission_type} onChange={(e) => set('commission_type', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Importo (€)" required>
              <Input type="number" min={0} step="0.01" value={values.amount} onChange={(e) => set('amount', e.target.value)} required />
            </FormField>
            <FormField label="Percentuale (%)">
              <Input type="number" min={0} max={100} step="0.01" value={values.percentage} onChange={(e) => set('percentage', e.target.value)} />
            </FormField>
            <FormField label="Scadenza">
              <Input type="date" value={values.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </FormField>
          </div>

          <FormField label="ID Contratto" className="max-w-xs">
            <Input type="number" min={0} value={values.contract_id} onChange={(e) => set('contract_id', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/commissions')}>
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
