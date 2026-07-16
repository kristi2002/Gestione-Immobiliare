import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
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
import { useTenantOptions } from '@/features/tenants/api';
import { GenerateScheduleButton } from './components/GenerateScheduleButton';
import { useContract, useCreateContract, useUpdateContract, type ContractFormValues } from './api';

const CONTRACT_TYPE_OPTIONS = [
  { value: 'locazione', label: 'Locazione' },
  { value: 'compravendita', label: 'Compravendita' },
  { value: 'preliminare', label: 'Preliminare' },
  { value: 'mandato', label: 'Mandato' },
  { value: 'altro', label: 'Altro' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Automatico' },
  { value: 'draft', label: 'Bozza' },
  { value: 'sent', label: 'Inviato' },
  { value: 'signed', label: 'Firmato' },
  { value: 'cancelled', label: 'Annullato' },
];

const SUBTYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: '4+4', label: '4+4 (Libero)' },
  { value: '3+2', label: '3+2 (Concordato)' },
  { value: 'transitorio', label: 'Transitorio' },
  { value: 'studenti', label: 'Studenti' },
  { value: 'comodato', label: 'Comodato' },
  { value: 'commerciale', label: 'Commerciale (6+6)' },
];

const EMPTY: ContractFormValues = {
  title: '',
  contract_type: 'locazione',
  status: '',
  property_id: '',
  tenant_id: '',
  client_id: '',
  start_date: '',
  end_date: '',
  monthly_rent: '',
  deposit: '',
  notes: '',
  contract_subtype: '',
  cedolare_secca: false,
  registration_number: '',
  registration_date: '',
  registration_office: '',
  imposta_registro_due_date: '',
  registration_tax_annual: '',
  stamp_duty: '',
  istat_update_enabled: false,
  istat_baseline_index: '',
  istat_baseline_month: '',
};

export default function ContractFormPage() {
  const { id } = useParams<{ id: string }>();
  const contractId = id ? Number(id) : undefined;
  const isEdit = contractId != null;
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const { data: contract, isLoading } = useContract(contractId);
  const { data: properties } = usePropertyOptions();
  const { data: clients } = useClientOptions();
  const { data: tenants } = useTenantOptions();
  const create = useCreateContract();
  const update = useUpdateContract(contractId ?? 0);

  const [values, setValues] = useState<ContractFormValues>(() => ({
    ...EMPTY,
    property_id: params.get('propertyId') ?? '',
    client_id: params.get('clientId') ?? '',
  }));
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!contract || hydrated.current) return;
    hydrated.current = true;
    setValues({
      title: contract.title,
      contract_type: contract.contract_type,
      status: contract.status ?? '',
      property_id: String(contract.property_id),
      tenant_id: contract.tenant_id != null ? String(contract.tenant_id) : '',
      client_id: contract.client_id != null ? String(contract.client_id) : '',
      start_date: contract.start_date ?? '',
      end_date: contract.end_date ?? '',
      monthly_rent: contract.monthly_rent ?? '',
      deposit: contract.deposit ?? '',
      notes: contract.notes ?? '',
      contract_subtype: contract.contract_subtype ?? '',
      cedolare_secca: Boolean(Number(contract.cedolare_secca)),
      registration_number: contract.registration_number ?? '',
      registration_date: contract.registration_date ?? '',
      registration_office: contract.registration_office ?? '',
      imposta_registro_due_date: contract.imposta_registro_due_date ?? '',
      registration_tax_annual: contract.registration_tax_annual ?? '',
      stamp_duty: contract.stamp_duty ?? '',
      istat_update_enabled: Boolean(Number(contract.istat_update_enabled)),
      istat_baseline_index: contract.istat_baseline_index ?? '',
      istat_baseline_month: contract.istat_baseline_month ?? '',
    });
  }, [contract]);

  function set<K extends keyof ContractFormValues>(k: K, value: ContractFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate('/contracts');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Contratto" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/contracts">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Contratto' : 'Nuovo Contratto'} subtitle="Locazioni, compravendite e mandati." />

      {isEdit && contract && contract.contract_type === 'locazione' && (
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-semibold text-navy">Scadenzario pagamenti</p>
            <p className="text-xs text-muted">Genera automaticamente le rate mensili per questo contratto.</p>
          </div>
          <GenerateScheduleButton contract={contract} />
        </Card>
      )}

      <Card className="space-y-8 p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Dati principali</legend>
            <FormField label="Titolo" required>
              <Input value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={255} required />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Tipo contratto">
                <Select options={CONTRACT_TYPE_OPTIONS} value={values.contract_type} onChange={(e) => set('contract_type', e.target.value)} />
              </FormField>
              <FormField label="Stato">
                <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
              </FormField>
              <FormField label="Sottotipo">
                <Select options={SUBTYPE_OPTIONS} value={values.contract_subtype} onChange={(e) => set('contract_subtype', e.target.value)} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Immobile" required>
                <Select
                  options={(properties ?? []).map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
                  placeholder="— Seleziona immobile —"
                  value={values.property_id}
                  onChange={(e) => set('property_id', e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Inquilino">
                <Select
                  options={(tenants ?? []).map((t) => ({ value: String(t.id), label: `${t.name} ${t.surname ?? ''}` }))}
                  placeholder="— Nessuno —"
                  value={values.tenant_id}
                  onChange={(e) => set('tenant_id', e.target.value)}
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
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Data inizio">
                <Input type="date" value={values.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </FormField>
              <FormField label="Data fine">
                <Input type="date" value={values.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </FormField>
              <FormField label="Canone mensile (€)">
                <Input type="number" min={0} step="0.01" value={values.monthly_rent} onChange={(e) => set('monthly_rent', e.target.value)} />
              </FormField>
              <FormField label="Deposito (€)">
                <Input type="number" min={0} step="0.01" value={values.deposit} onChange={(e) => set('deposit', e.target.value)} />
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
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Registrazione e fisco (locazione)</legend>

            <label className="flex items-center gap-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={values.cedolare_secca}
                onChange={(e) => set('cedolare_secca', e.target.checked)}
                className="size-4 rounded border-border"
              />
              Cedolare secca
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="N. registrazione">
                <Input value={values.registration_number} onChange={(e) => set('registration_number', e.target.value)} maxLength={50} />
              </FormField>
              <FormField label="Data registrazione">
                <Input type="date" value={values.registration_date} onChange={(e) => set('registration_date', e.target.value)} />
              </FormField>
              <FormField label="Ufficio Agenzia Entrate">
                <Input value={values.registration_office} onChange={(e) => set('registration_office', e.target.value)} maxLength={120} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Scadenza imposta di registro">
                <Input type="date" value={values.imposta_registro_due_date} onChange={(e) => set('imposta_registro_due_date', e.target.value)} />
              </FormField>
              <FormField label="Imposta di registro annua (€)">
                <Input type="number" min={0} step="0.01" value={values.registration_tax_annual} onChange={(e) => set('registration_tax_annual', e.target.value)} />
              </FormField>
              <FormField label="Imposta di bollo (€)">
                <Input type="number" step="0.01" value={values.stamp_duty} onChange={(e) => set('stamp_duty', e.target.value)} />
              </FormField>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={values.istat_update_enabled}
                onChange={(e) => set('istat_update_enabled', e.target.checked)}
                className="size-4 rounded border-border"
              />
              Aggiornamento ISTAT canone
            </label>

            {values.istat_update_enabled && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Indice ISTAT di base">
                  <Input type="number" step="0.001" value={values.istat_baseline_index} onChange={(e) => set('istat_baseline_index', e.target.value)} placeholder="es. 118.2" />
                </FormField>
                <FormField label="Mese di riferimento (AAAA-MM)">
                  <Input value={values.istat_baseline_month} onChange={(e) => set('istat_baseline_month', e.target.value)} maxLength={7} placeholder="es. 2024-01" />
                </FormField>
              </div>
            )}
          </fieldset>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/contracts')}>
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
