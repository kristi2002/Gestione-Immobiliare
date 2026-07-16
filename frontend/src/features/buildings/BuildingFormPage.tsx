import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FormField } from '@/components/common/FormField';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { useBuilding, useCreateBuilding, useUpdateBuilding, type BuildingFormValues } from './api';

const EMPTY: BuildingFormValues = { name: '', city: '', address: '', total_units: '', notes: '' };

export default function BuildingFormPage() {
  const { id } = useParams<{ id: string }>();
  const buildingId = id ? Number(id) : undefined;
  const isEdit = buildingId != null;
  const navigate = useNavigate();

  const { data: building, isLoading } = useBuilding(buildingId);
  const create = useCreateBuilding();
  const update = useUpdateBuilding(buildingId ?? 0);

  const [values, setValues] = useState<BuildingFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!building || hydrated.current) return;
    hydrated.current = true;
    setValues({
      name: building.name,
      city: building.city,
      address: building.address,
      total_units: building.total_units != null ? String(building.total_units) : '',
      notes: building.notes ?? '',
    });
  }, [building]);

  function set<K extends keyof BuildingFormValues>(key: K, value: BuildingFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/buildings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Edificio" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/buildings">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Edificio' : 'Nuovo Edificio'} subtitle="Stabile o condominio in gestione." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <FormField label="Nome" required>
            <Input value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={150} required />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Indirizzo" required>
              <Input value={values.address} onChange={(e) => set('address', e.target.value)} maxLength={255} required />
            </FormField>
            <FormField label="Città" required>
              <Input value={values.city} onChange={(e) => set('city', e.target.value)} maxLength={100} required />
            </FormField>
          </div>

          <FormField label="Numero unità" className="max-w-xs">
            <Input type="number" min={0} value={values.total_units} onChange={(e) => set('total_units', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/buildings')}>
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
