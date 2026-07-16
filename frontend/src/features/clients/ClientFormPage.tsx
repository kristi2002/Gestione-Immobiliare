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
import { useClient, useCreateClient, useUpdateClient, useAgents, type ClientFormValues } from './api';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Attivo' },
  { value: 'inactive', label: 'Inattivo' },
  { value: 'archived', label: 'Archiviato' },
];

const EMPTY: ClientFormValues = {
  name: '',
  surname: '',
  codice_fiscale: '',
  phone: '',
  email: '',
  status: 'active',
  assigned_agent_id: '',
  internal_notes: '',
};

export default function ClientFormPage() {
  const { id } = useParams<{ id: string }>();
  const clientId = id ? Number(id) : null;
  const isEdit = clientId != null;
  const navigate = useNavigate();

  const { data: client, isLoading } = useClient(clientId);
  const { data: agents } = useAgents();
  const create = useCreateClient();
  const update = useUpdateClient(clientId ?? 0);

  const [values, setValues] = useState<ClientFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!client || hydrated.current) return;
    hydrated.current = true;
    setValues({
      name: client.name,
      surname: client.surname ?? '',
      codice_fiscale: client.codice_fiscale ?? '',
      phone: client.phone ?? '',
      email: client.email ?? '',
      status: client.status,
      assigned_agent_id: client.assigned_agent_id != null ? String(client.assigned_agent_id) : '',
      internal_notes: client.internal_notes ?? '',
    });
  }, [client]);

  function set<K extends keyof ClientFormValues>(k: K, value: ClientFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      // Legacy lands on the client's profile page after save; React doesn't
      // have a dedicated /clients/:id profile route yet (a separate "view"
      // gap, not a create/edit one) — back to the list until that exists.
      navigate('/clients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Proprietario" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/clients">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Proprietario' : 'Nuovo Proprietario'} subtitle="Anagrafica proprietari immobiliari." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Nome" required>
              <Input value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required />
            </FormField>
            <FormField label="Cognome" required>
              <Input value={values.surname} onChange={(e) => set('surname', e.target.value)} maxLength={100} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Codice Fiscale" required>
              <Input
                value={values.codice_fiscale}
                onChange={(e) => set('codice_fiscale', e.target.value.toUpperCase())}
                maxLength={16}
                className="uppercase"
                required
              />
            </FormField>
            <FormField label="Telefono">
              <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} maxLength={255} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
            </FormField>
            <FormField label="Agente di riferimento">
              <Select
                options={(agents ?? []).map((a) => ({ value: String(a.id), label: a.username }))}
                placeholder="— Nessuno —"
                value={values.assigned_agent_id}
                onChange={(e) => set('assigned_agent_id', e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Note interne">
            <textarea
              value={values.internal_notes}
              onChange={(e) => set('internal_notes', e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </FormField>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/clients')}>
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
