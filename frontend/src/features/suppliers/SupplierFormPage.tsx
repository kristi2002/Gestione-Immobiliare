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
import { useSupplier, useCreateSupplier, useUpdateSupplier, type SupplierFormValues } from './api';

/** Source of truth is api/suppliers.php's SUPPLIER_CATEGORIES — the legacy
 * HTML modal's option list drifted from it (offers giardinaggio/ascensore/
 * serrature, which the backend rejects, and is missing imbianchino/
 * giardiniere, which the backend accepts). Using the real list here. */
const CATEGORY_OPTIONS = [
  { value: 'idraulico', label: 'Idraulico' },
  { value: 'elettricista', label: 'Elettricista' },
  { value: 'muratore', label: 'Muratore' },
  { value: 'falegname', label: 'Falegname' },
  { value: 'imbianchino', label: 'Imbianchino' },
  { value: 'giardiniere', label: 'Giardiniere' },
  { value: 'pulizie', label: 'Pulizie' },
  { value: 'altro', label: 'Altro' },
];

const EMPTY: SupplierFormValues = { name: '', category: 'altro', phone: '', email: '', address: '', rating: '', notes: '' };

export default function SupplierFormPage() {
  const { id } = useParams<{ id: string }>();
  const supplierId = id ? Number(id) : undefined;
  const isEdit = supplierId != null;
  const navigate = useNavigate();

  const { data: supplier, isLoading } = useSupplier(supplierId);
  const create = useCreateSupplier();
  const update = useUpdateSupplier(supplierId ?? 0);

  const [values, setValues] = useState<SupplierFormValues>(EMPTY);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!supplier || hydrated.current) return;
    hydrated.current = true;
    setValues({
      name: supplier.name,
      category: supplier.category,
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      rating: supplier.rating != null ? String(supplier.rating) : '',
      notes: supplier.notes ?? '',
    });
  }, [supplier]);

  function set<K extends keyof SupplierFormValues>(k: K, value: SupplierFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      // Backend rejects rating=0 (must be 1-5 if present) — omit rather than
      // send a default 0, unlike the legacy JS which always sent one.
      const payload = { ...values, rating: values.rating === '0' ? '' : values.rating };
      if (isEdit) await update.mutateAsync(payload);
      else await create.mutateAsync(payload);
      navigate('/suppliers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Fornitore" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/suppliers">
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader title={isEdit ? 'Modifica Fornitore' : 'Nuovo Fornitore'} subtitle="Anagrafica fornitori e manutentori." />

      <Card className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Nome" required>
              <Input value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={150} required />
            </FormField>
            <FormField label="Categoria" required>
              <Select options={CATEGORY_OPTIONS} value={values.category} onChange={(e) => set('category', e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Telefono">
              <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} maxLength={255} />
            </FormField>
          </div>

          <FormField label="Indirizzo">
            <Input value={values.address} onChange={(e) => set('address', e.target.value)} maxLength={255} />
          </FormField>

          <FormField label="Valutazione (1-5)" className="max-w-xs">
            <Input type="number" min={1} max={5} step={1} value={values.rating} onChange={(e) => set('rating', e.target.value)} placeholder="Nessuna" />
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
            <Button type="button" variant="ghost" onClick={() => navigate('/suppliers')}>
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
