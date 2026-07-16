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
import { useMeterReading, useCreateMeterReading, useUpdateMeterReading, type MeterFormValues } from './api';

const TYPE_OPTIONS = [
  { value: 'gas', label: 'Gas' },
  { value: 'electricity', label: 'Elettricità' },
  { value: 'water', label: 'Acqua' },
  { value: 'heating', label: 'Riscaldamento' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: MeterFormValues = { property_id: '', meter_type: 'electricity', reading_value: '', reading_date: today(), notes: '' };

export default function MeterFormPage() {
  const { id } = useParams<{ id: string }>();
  const meterId = id ? Number(id) : undefined;
  const isEdit = meterId != null;
  const navigate = useNavigate();

  const { data: reading, isLoading } = useMeterReading(meterId);
  const { data: properties } = usePropertyOptions();
  const create = useCreateMeterReading();
  const update = useUpdateMeterReading(meterId ?? 0);

  const [values, setValues] = useState<MeterFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!reading || hydrated.current) return;
    hydrated.current = true;
    setValues({
      property_id: String(reading.property_id),
      meter_type: reading.meter_type,
      reading_value: reading.reading_value,
      reading_date: reading.reading_date,
      notes: reading.notes ?? '',
    });
  }, [reading]);

  function set<K extends keyof MeterFormValues>(k: K, value: MeterFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/meters');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Lettura" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/meters">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Lettura' : 'Nuova Lettura'} subtitle="Registra una lettura contatore." />

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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Tipo contatore" required>
              <Select options={TYPE_OPTIONS} value={values.meter_type} onChange={(e) => set('meter_type', e.target.value as MeterFormValues['meter_type'])} required />
            </FormField>
            <FormField label="Valore lettura" required>
              <Input type="number" min={0} step="0.01" value={values.reading_value} onChange={(e) => set('reading_value', e.target.value)} required />
            </FormField>
            <FormField label="Data lettura" required>
              <Input type="date" value={values.reading_date} onChange={(e) => set('reading_date', e.target.value)} required />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/meters')}>
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
