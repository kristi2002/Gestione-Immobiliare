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
import { useLeadAgents } from '@/features/leads/api';
import { useKey, useCreateKey, useUpdateKey, type KeyFormValues } from './api';

const STATUS_OPTIONS = [
  { value: 'in_office', label: 'In ufficio' },
  { value: 'out', label: 'Consegnata' },
  { value: 'lost', label: 'Smarrita' },
];

const EMPTY: KeyFormValues = {
  property_id: '',
  holder_id: '',
  holder_name: '',
  status: 'in_office',
  location: '',
  handed_at: '',
  returned_at: '',
  notes: '',
};

export default function KeyFormPage() {
  const { id } = useParams<{ id: string }>();
  const keyId = id ? Number(id) : undefined;
  const isEdit = keyId != null;
  const navigate = useNavigate();

  const { data: key, isLoading } = useKey(keyId);
  const { data: properties } = usePropertyOptions();
  const { data: agents } = useLeadAgents();
  const create = useCreateKey();
  const update = useUpdateKey(keyId ?? 0);

  const [values, setValues] = useState<KeyFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!key || hydrated.current) return;
    hydrated.current = true;
    setValues({
      property_id: String(key.property_id),
      holder_id: key.holder_id != null ? String(key.holder_id) : '',
      holder_name: key.holder_name ?? '',
      status: key.status,
      location: key.location ?? '',
      handed_at: key.handed_at ?? '',
      returned_at: key.returned_at ?? '',
      notes: key.notes ?? '',
    });
  }, [key]);

  function set<K extends keyof KeyFormValues>(k: K, value: KeyFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/keys');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Chiave" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/keys">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Chiave' : 'Nuova Chiave'} subtitle="Gestione consegne chiavi immobili." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Immobile" required>
              <Select
                options={(properties ?? []).map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
                placeholder="— Seleziona immobile —"
                value={values.property_id}
                onChange={(e) => set('property_id', e.target.value)}
                required
              />
            </FormField>
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value as KeyFormValues['status'])} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Titolare (agente)">
              <Select
                options={(agents ?? []).map((a) => ({ value: String(a.id), label: a.username }))}
                placeholder="— Nessuno —"
                value={values.holder_id}
                onChange={(e) => set('holder_id', e.target.value)}
              />
            </FormField>
            <FormField label="Titolare (nome libero)">
              <Input value={values.holder_name} onChange={(e) => set('holder_name', e.target.value)} placeholder="Se non è un agente" />
            </FormField>
          </div>

          <FormField label="Posizione">
            <Input value={values.location} onChange={(e) => set('location', e.target.value)} placeholder="es. Bacheca ufficio" />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Data consegna">
              <Input type="date" value={values.handed_at} onChange={(e) => set('handed_at', e.target.value)} />
            </FormField>
            <FormField label="Data restituzione">
              <Input type="date" value={values.returned_at} onChange={(e) => set('returned_at', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/keys')}>
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
