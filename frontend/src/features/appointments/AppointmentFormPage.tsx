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
import { useLeadOptions, useLeadAgents } from '@/features/leads/api';
import { useAppointment, useCreateAppointment, useUpdateAppointment, type AppointmentFormValues } from './api';
import { leadName } from '@/features/leads/utils';

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Programmato' },
  { value: 'completed', label: 'Completato' },
  { value: 'cancelled', label: 'Annullato' },
  { value: 'no_show', label: 'Non presentato' },
];

function tomorrowAt10() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

const EMPTY: AppointmentFormValues = {
  property_id: '',
  lead_id: '',
  client_id: '',
  agent_id: '',
  appointment_date: tomorrowAt10(),
  duration_minutes: '60',
  status: 'scheduled',
  notes: '',
};

export default function AppointmentFormPage() {
  const { id } = useParams<{ id: string }>();
  const appointmentId = id ? Number(id) : undefined;
  const isEdit = appointmentId != null;
  const navigate = useNavigate();

  const { data: appointment, isLoading } = useAppointment(appointmentId);
  const { data: properties } = usePropertyOptions();
  const { data: leads } = useLeadOptions();
  const { data: clients } = useClientOptions();
  const { data: agents } = useLeadAgents();
  const create = useCreateAppointment();
  const update = useUpdateAppointment(appointmentId ?? 0);

  const [values, setValues] = useState<AppointmentFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!appointment || hydrated.current) return;
    hydrated.current = true;
    setValues({
      property_id: String(appointment.property_id),
      lead_id: appointment.lead_id != null ? String(appointment.lead_id) : '',
      client_id: appointment.client_id != null ? String(appointment.client_id) : '',
      agent_id: appointment.agent_id != null ? String(appointment.agent_id) : '',
      appointment_date: appointment.appointment_date.slice(0, 16),
      duration_minutes: String(appointment.duration_minutes),
      status: appointment.status,
      notes: appointment.notes ?? '',
    });
  }, [appointment]);

  function set<K extends keyof AppointmentFormValues>(k: K, value: AppointmentFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/appointments');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Visita" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/appointments">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Visita' : 'Nuova Visita'} subtitle="Appuntamenti e visite immobili." />

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
            <FormField label="Lead">
              <Select
                options={(leads ?? []).map((l) => ({ value: String(l.id), label: leadName(l) }))}
                placeholder="— Nessuno —"
                value={values.lead_id}
                onChange={(e) => set('lead_id', e.target.value)}
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
            <FormField label="Agente">
              <Select
                options={(agents ?? []).map((a) => ({ value: String(a.id), label: a.username }))}
                placeholder="— Nessuno —"
                value={values.agent_id}
                onChange={(e) => set('agent_id', e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Data e ora" required>
              <Input type="datetime-local" value={values.appointment_date} onChange={(e) => set('appointment_date', e.target.value)} required />
            </FormField>
            <FormField label="Durata (minuti)">
              <Input type="number" min={1} step={5} value={values.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} />
            </FormField>
            <FormField label="Stato">
              <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/appointments')}>
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
