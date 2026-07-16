import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FormField } from '@/components/common/FormField';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import { usePropertyOptions } from '@/features/properties/api';
import { useClientOptions } from '@/features/clients/api';
import { useContractOptions } from '@/features/contracts/api';
import { useUploadDocument, type DocumentUploadValues } from './api';

const TYPE_OPTIONS = [
  { value: 'invoice', label: 'Fattura' },
  { value: 'contract', label: 'Contratto' },
  { value: 'id', label: 'Documento identità' },
  { value: 'other', label: 'Altro' },
];

const EMPTY: DocumentUploadValues = {
  doc_type: 'invoice',
  title: '',
  notes: '',
  client_id: '',
  property_id: '',
  contract_id: '',
  file: null,
};

/** Documents have no edit — only upload (create) and delete, matching the
 * legacy PHP feature exactly (there's no PUT endpoint for documents). */
export default function DocumentFormPage() {
  const navigate = useNavigate();
  const { data: properties } = usePropertyOptions();
  const { data: clients } = useClientOptions();
  const { data: contracts } = useContractOptions();
  const upload = useUploadDocument();

  const [values, setValues] = useState<DocumentUploadValues>(EMPTY);
  const [error, setError] = useState('');

  function set<K extends keyof DocumentUploadValues>(k: K, value: DocumentUploadValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!values.client_id && !values.property_id && !values.contract_id) {
      setError('Associa il documento ad almeno un proprietario, un immobile o un contratto.');
      return;
    }
    if (!values.file) {
      setError('Seleziona un file.');
      return;
    }
    try {
      await upload.mutateAsync(values);
      navigate('/documents');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Caricamento non riuscito.');
    }
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/documents">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title="Carica Documento" subtitle="Associa il file a un proprietario, immobile o contratto." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Tipo documento" required>
              <Select options={TYPE_OPTIONS} value={values.doc_type} onChange={(e) => set('doc_type', e.target.value)} required />
            </FormField>
            <FormField label="Titolo">
              <Input value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={255} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Proprietario">
              <Select
                options={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.surname} ${c.name}` }))}
                placeholder="— Nessuno —"
                value={values.client_id}
                onChange={(e) => set('client_id', e.target.value)}
              />
            </FormField>
            <FormField label="Immobile">
              <Select
                options={(properties ?? []).map((p) => ({ value: String(p.id), label: `${p.address}, ${p.city ?? ''}` }))}
                placeholder="— Nessuno —"
                value={values.property_id}
                onChange={(e) => set('property_id', e.target.value)}
              />
            </FormField>
            <FormField label="Contratto">
              <Select
                options={(contracts ?? []).map((c) => ({ value: String(c.id), label: `${c.title} — ${c.property_address ?? ''}` }))}
                placeholder="— Nessuno —"
                value={values.contract_id}
                onChange={(e) => set('contract_id', e.target.value)}
              />
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-muted">Associa il documento ad almeno un proprietario, un immobile o un contratto.</p>

          <FormField label="File" required>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-white px-4 py-3 text-sm text-muted hover:border-primary/40">
              <Upload className="size-4" />
              {values.file ? values.file.name : 'Scegli un file (PDF, JPG, PNG, DOC, ODT, TXT — max 25MB)'}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.odt,.txt"
                onChange={(e) => set('file', e.target.files?.[0] ?? null)}
                required
              />
            </label>
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
            <Button type="button" variant="ghost" onClick={() => navigate('/documents')}>
              Annulla
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending ? 'Caricamento…' : 'Carica'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
