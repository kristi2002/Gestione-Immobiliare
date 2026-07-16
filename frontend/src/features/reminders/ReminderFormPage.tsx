import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { useReminder, useCreateReminder, useUpdateReminder, type ReminderFormValues } from './api';

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Una volta' },
  { value: 'weekly', label: 'Settimanale' },
  { value: 'biweekly', label: 'Ogni due settimane' },
  { value: 'monthly', label: 'Mensile' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'yearly', label: 'Annuale' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'In sospeso' },
  { value: 'completed', label: 'Completato' },
  { value: 'cancelled', label: 'Annullato' },
];

function tomorrowAt9() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

const EMPTY: ReminderFormValues = {
  title: '',
  description: '',
  reminder_date: tomorrowAt9(),
  frequency: 'once',
  status: 'pending',
  client_id: '',
  property_id: '',
  notify_admin: true,
  notify_client: false,
  email_subject: '',
  email_body: '',
};

export default function ReminderFormPage() {
  const { id } = useParams<{ id: string }>();
  const reminderId = id ? Number(id) : undefined;
  const isEdit = reminderId != null;
  const navigate = useNavigate();

  const { data: reminder, isLoading } = useReminder(reminderId);
  const { data: properties } = usePropertyOptions();
  const { data: clients } = useClientOptions();
  const create = useCreateReminder();
  const update = useUpdateReminder(reminderId ?? 0);

  const [values, setValues] = useState<ReminderFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!reminder || hydrated.current) return;
    hydrated.current = true;
    setValues({
      title: reminder.title,
      description: reminder.description ?? '',
      reminder_date: reminder.reminder_date.slice(0, 16),
      frequency: reminder.frequency,
      status: reminder.status,
      client_id: reminder.client_id != null ? String(reminder.client_id) : '',
      property_id: reminder.property_id != null ? String(reminder.property_id) : '',
      notify_admin: Boolean(Number(reminder.notify_admin)),
      notify_client: Boolean(Number(reminder.notify_client)),
      email_subject: reminder.email_subject ?? '',
      email_body: reminder.email_body ?? '',
    });
  }, [reminder]);

  function set<K extends keyof ReminderFormValues>(k: K, value: ReminderFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  const filteredProperties = useMemo(() => {
    if (!properties) return [];
    if (!values.client_id) return properties;
    return properties.filter((p) => String(p.client_id) === values.client_id);
  }, [properties, values.client_id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/reminders');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Promemoria" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/reminders">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Promemoria' : 'Nuovo Promemoria'} subtitle="Attività e scadenze." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <FormField label="Titolo" required>
            <Input value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={255} required />
          </FormField>

          <FormField label="Descrizione">
            <textarea
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Data e ora" required>
              <Input type="datetime-local" value={values.reminder_date} onChange={(e) => set('reminder_date', e.target.value)} required />
            </FormField>
            <FormField label="Ricorrenza">
              <Select options={FREQUENCY_OPTIONS} value={values.frequency} onChange={(e) => set('frequency', e.target.value)} />
            </FormField>
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Proprietario">
              <Select
                options={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.surname} ${c.name}` }))}
                placeholder="— Nessuno —"
                value={values.client_id}
                onChange={(e) => {
                  set('client_id', e.target.value);
                  set('property_id', '');
                }}
              />
            </FormField>
            <FormField label="Immobile">
              <Select
                options={filteredProperties.map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
                placeholder="— Nessuno —"
                value={values.property_id}
                onChange={(e) => set('property_id', e.target.value)}
              />
            </FormField>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-navy">
              <input type="checkbox" checked={values.notify_admin} onChange={(e) => set('notify_admin', e.target.checked)} className="size-4 rounded border-border" />
              Notifica amministratore
            </label>
            <label className="flex items-center gap-2 text-sm text-navy">
              <input type="checkbox" checked={values.notify_client} onChange={(e) => set('notify_client', e.target.checked)} className="size-4 rounded border-border" />
              Notifica cliente via email
            </label>
          </div>

          {values.notify_client && (
            <div className="space-y-4 rounded-xl border border-border bg-slate-50/60 p-4">
              <FormField label="Oggetto email">
                <Input value={values.email_subject} onChange={(e) => set('email_subject', e.target.value)} maxLength={255} />
              </FormField>
              <FormField label="Corpo email">
                <textarea
                  value={values.email_body}
                  onChange={(e) => set('email_body', e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </FormField>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/reminders')}>
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
