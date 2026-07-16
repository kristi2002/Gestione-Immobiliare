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
import { useInventoryItem, useCreateInventoryItem, useUpdateInventoryItem, type InventoryFormValues } from './api';

const CATEGORY_OPTIONS = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'elettrodomestico', label: 'Elettrodomestico' },
  { value: 'arredamento', label: 'Arredamento' },
  { value: 'impianto', label: 'Impianto' },
  { value: 'altro', label: 'Altro' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: InventoryFormValues = {
  property_id: '',
  item_name: '',
  category: '',
  quantity: '1',
  condition_rating: '3',
  check_in_date: today(),
  notes: '',
};

export default function InventoryFormPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = id ? Number(id) : undefined;
  const isEdit = itemId != null;
  const navigate = useNavigate();

  const { data: item, isLoading } = useInventoryItem(itemId);
  const { data: properties } = usePropertyOptions();
  const create = useCreateInventoryItem();
  const update = useUpdateInventoryItem(itemId ?? 0);

  const [values, setValues] = useState<InventoryFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!item || hydrated.current) return;
    hydrated.current = true;
    setValues({
      property_id: String(item.property_id),
      item_name: item.item_name,
      category: item.category,
      quantity: String(item.quantity),
      condition_rating: item.condition_rating != null ? String(item.condition_rating) : '',
      check_in_date: item.check_in_date ?? '',
      notes: item.notes ?? '',
    });
  }, [item]);

  function set<K extends keyof InventoryFormValues>(k: K, value: InventoryFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/inventory');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Articolo" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/inventory">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Articolo' : 'Nuovo Articolo'} subtitle="Inventario immobile." />

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
            <FormField label="Nome articolo" required>
              <Input value={values.item_name} onChange={(e) => set('item_name', e.target.value)} maxLength={150} required />
            </FormField>
            <FormField label="Categoria" required>
              <Select options={CATEGORY_OPTIONS} placeholder="— Seleziona —" value={values.category} onChange={(e) => set('category', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Quantità">
              <Input type="number" min={1} step={1} value={values.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </FormField>
            <FormField label="Condizione (1-5)">
              <Input type="number" min={1} max={5} step={1} value={values.condition_rating} onChange={(e) => set('condition_rating', e.target.value)} />
            </FormField>
            <FormField label="Data check-in">
              <Input type="date" value={values.check_in_date} onChange={(e) => set('check_in_date', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/inventory')}>
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
