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
import { useClientOptions } from '@/features/clients/api';
import { useProperty, useCreateProperty, useUpdateProperty, type PropertyFormValues } from './api';

const STATUS_OPTIONS = [
  { value: 'available', label: 'Disponibile' },
  { value: 'rented', label: 'Affittato' },
  { value: 'sold', label: 'Venduto' },
  { value: 'archived', label: 'Archiviato' },
];

const TYPE_OPTIONS = [
  { value: 'appartamento', label: 'Appartamento' },
  { value: 'villa', label: 'Villa' },
  { value: 'ufficio', label: 'Ufficio' },
  { value: 'negozio', label: 'Negozio' },
  { value: 'box', label: 'Box / Garage' },
  { value: 'terreno', label: 'Terreno' },
  { value: 'altro', label: 'Altro' },
];

const CONDITION_OPTIONS = [
  { value: '', label: '—' },
  { value: 'nuovo', label: 'Nuovo / In costruzione' },
  { value: 'ottimo', label: 'Ottimo / Ristrutturato' },
  { value: 'buono', label: 'Buono / Abitabile' },
  { value: 'da_ristrutturare', label: 'Da ristrutturare' },
];

const GARDEN_OPTIONS = [
  { value: '', label: '—' },
  { value: 'no', label: 'No' },
  { value: 'privato', label: 'Privato' },
  { value: 'comune', label: 'Comune' },
];

const ENERGY_OPTIONS = ['', 'A4', 'A3', 'A2', 'A1', 'B', 'C', 'D', 'E', 'F', 'G', 'esente', 'in_attesa'].map((v) => ({
  value: v,
  label: v === '' ? '—' : v === 'esente' ? 'Esente' : v === 'in_attesa' ? 'In attesa' : v,
}));

const HEATING_OPTIONS = [
  { value: '', label: '—' },
  { value: 'autonomo', label: 'Autonomo' },
  { value: 'centralizzato', label: 'Centralizzato' },
  { value: 'assente', label: 'Assente' },
];

const FURNISHED_OPTIONS = [
  { value: '', label: '—' },
  { value: 'no', label: 'No' },
  { value: 'si', label: 'Sì' },
  { value: 'parziale', label: 'Parzialmente' },
];

const ELEVATOR_OPTIONS = [
  { value: '', label: '—' },
  { value: '1', label: 'Sì' },
  { value: '0', label: 'No' },
];

const PRICE_TYPE_OPTIONS = [
  { value: 'affitto', label: 'Affitto' },
  { value: 'vendita', label: 'Vendita' },
];

const EMPTY: PropertyFormValues = {
  client_id: '',
  status: 'available',
  address: '',
  city: '',
  cap: '',
  province: '',
  reference_code: '',
  floor: '',
  total_floors: '',
  exposure: '',
  property_type: 'appartamento',
  condition_state: '',
  year_built: '',
  sqm: '',
  locali: '',
  rooms: '',
  bathrooms: '',
  balconies: '',
  terraces: '',
  parking_spaces: '',
  garden: '',
  energy_class: '',
  heating: '',
  furnished: '',
  elevator: '',
  price: '',
  price_type: 'affitto',
  condo_fees: '',
  latitude: '',
  longitude: '',
  cadastral_comune: '',
  cadastral_category: '',
  cadastral_class: '',
  cadastral_foglio: '',
  cadastral_particella: '',
  cadastral_subalterno: '',
  cadastral_zone: '',
  cadastral_rendita: '',
  ape_number: '',
  ape_issue_date: '',
  ape_expiry_date: '',
  ipe_value: '',
  description: '',
  additional_features: '',
  internal_notes: '',
};

/**
 * Core create/edit form — covers every field the backend accepts except the
 * interactive enhancements (address-autocomplete, map picker, AI-generated
 * description, price-history view, agency-mandate PDF), which are UX
 * extras layered on top of plain data entry, not required to save a record.
 */
export default function PropertyFormPage() {
  const { id } = useParams<{ id: string }>();
  const propertyId = id ? Number(id) : undefined;
  const isEdit = propertyId != null;
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const { data: property, isLoading } = useProperty(propertyId ?? 0);
  const { data: clients } = useClientOptions();
  const create = useCreateProperty();
  const update = useUpdateProperty(propertyId ?? 0);

  const [values, setValues] = useState<PropertyFormValues>(() => ({
    ...EMPTY,
    client_id: params.get('clientId') ?? '',
  }));
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => {
    if (!property || hydrated.current) return;
    hydrated.current = true;
    setValues({
      client_id: String(property.client_id),
      status: property.status,
      address: property.address,
      city: property.city ?? '',
      cap: property.cap ?? '',
      province: property.province ?? '',
      reference_code: property.reference_code ?? '',
      floor: property.floor ?? '',
      total_floors: property.total_floors != null ? String(property.total_floors) : '',
      exposure: property.exposure ?? '',
      property_type: property.property_type ?? 'appartamento',
      condition_state: property.condition_state ?? '',
      year_built: property.year_built != null ? String(property.year_built) : '',
      sqm: property.sqm ?? '',
      locali: property.locali != null ? String(property.locali) : '',
      rooms: property.rooms != null ? String(property.rooms) : '',
      bathrooms: property.bathrooms != null ? String(property.bathrooms) : '',
      balconies: property.balconies != null ? String(property.balconies) : '',
      terraces: property.terraces != null ? String(property.terraces) : '',
      parking_spaces: property.parking_spaces != null ? String(property.parking_spaces) : '',
      garden: property.garden ?? '',
      energy_class: property.energy_class ?? '',
      heating: property.heating ?? '',
      furnished: property.furnished ?? '',
      elevator: property.elevator != null ? String(property.elevator) : '',
      price: property.price ?? '',
      price_type: property.price_type ?? 'affitto',
      condo_fees: property.condo_fees ?? '',
      latitude: property.latitude ?? '',
      longitude: property.longitude ?? '',
      cadastral_comune: property.cadastral_comune ?? '',
      cadastral_category: property.cadastral_category ?? '',
      cadastral_class: property.cadastral_class ?? '',
      cadastral_foglio: property.cadastral_foglio ?? '',
      cadastral_particella: property.cadastral_particella ?? '',
      cadastral_subalterno: property.cadastral_subalterno ?? '',
      cadastral_zone: property.cadastral_zone ?? '',
      cadastral_rendita: property.cadastral_rendita ?? '',
      ape_number: property.ape_number ?? '',
      ape_issue_date: property.ape_issue_date ?? '',
      ape_expiry_date: property.ape_expiry_date ?? '',
      ipe_value: property.ipe_value ?? '',
      description: property.description ?? '',
      additional_features: property.additional_features ?? '',
      internal_notes: property.internal_notes ?? '',
    });
  }, [property]);

  function set<K extends keyof PropertyFormValues>(k: K, value: PropertyFormValues[K]) {
    setValues((v) => ({ ...v, [k]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await update.mutateAsync(values);
      else await create.mutateAsync(values);
      navigate(isEdit && propertyId ? `/properties/${propertyId}` : '/properties');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    }
  }

  const saving = create.isPending || update.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Modifica Immobile" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={isEdit && propertyId ? `/properties/${propertyId}` : '/properties'}>
          <ArrowLeft className="size-4" />
          Indietro
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? 'Modifica Immobile' : 'Nuovo Immobile'}
        subtitle="Compila i dati dell'immobile."
      />

      <Card className="space-y-8 p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</div>
          )}

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Proprietario e ubicazione</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Proprietario" required>
                <Select
                  options={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.surname} ${c.name}` }))}
                  placeholder="— Seleziona proprietario —"
                  value={values.client_id}
                  onChange={(e) => set('client_id', e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Stato">
                <Select options={STATUS_OPTIONS} value={values.status} onChange={(e) => set('status', e.target.value)} />
              </FormField>
            </div>

            <FormField label="Indirizzo" required>
              <Input value={values.address} onChange={(e) => set('address', e.target.value)} maxLength={255} required />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Città" required>
                <Input value={values.city} onChange={(e) => set('city', e.target.value)} maxLength={100} required />
              </FormField>
              <FormField label="CAP">
                <Input value={values.cap} onChange={(e) => set('cap', e.target.value)} maxLength={10} placeholder="62012" />
              </FormField>
              <FormField label="Provincia">
                <Input value={values.province} onChange={(e) => set('province', e.target.value)} maxLength={10} placeholder="MC" />
              </FormField>
              <FormField label="Riferimento">
                <Input value={values.reference_code} onChange={(e) => set('reference_code', e.target.value)} maxLength={50} placeholder="es. RIF-001" />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Piano">
                <Input value={values.floor} onChange={(e) => set('floor', e.target.value)} maxLength={20} placeholder="es. 2, T, R" />
              </FormField>
              <FormField label="Piani edificio">
                <Input type="number" min={0} value={values.total_floors} onChange={(e) => set('total_floors', e.target.value)} />
              </FormField>
              <FormField label="Esposizione">
                <Input value={values.exposure} onChange={(e) => set('exposure', e.target.value)} maxLength={60} placeholder="es. Sud, Est/Ovest" />
              </FormField>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Caratteristiche</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Tipologia">
                <Select options={TYPE_OPTIONS} value={values.property_type} onChange={(e) => set('property_type', e.target.value)} />
              </FormField>
              <FormField label="Stato immobile">
                <Select options={CONDITION_OPTIONS} value={values.condition_state} onChange={(e) => set('condition_state', e.target.value)} />
              </FormField>
              <FormField label="Anno costruzione">
                <Input type="number" min={1800} max={2099} value={values.year_built} onChange={(e) => set('year_built', e.target.value)} placeholder="es. 1985" />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Superficie (m²)">
                <Input type="number" min={0} step="0.01" value={values.sqm} onChange={(e) => set('sqm', e.target.value)} />
              </FormField>
              <FormField label="Locali">
                <Input type="number" min={0} value={values.locali} onChange={(e) => set('locali', e.target.value)} />
              </FormField>
              <FormField label="Camere">
                <Input type="number" min={0} value={values.rooms} onChange={(e) => set('rooms', e.target.value)} />
              </FormField>
              <FormField label="Bagni">
                <Input type="number" min={0} value={values.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Balconi">
                <Input type="number" min={0} value={values.balconies} onChange={(e) => set('balconies', e.target.value)} />
              </FormField>
              <FormField label="Terrazzi">
                <Input type="number" min={0} value={values.terraces} onChange={(e) => set('terraces', e.target.value)} />
              </FormField>
              <FormField label="Posti auto / Box">
                <Input type="number" min={0} value={values.parking_spaces} onChange={(e) => set('parking_spaces', e.target.value)} />
              </FormField>
              <FormField label="Giardino">
                <Select options={GARDEN_OPTIONS} value={values.garden} onChange={(e) => set('garden', e.target.value)} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Classe energetica">
                <Select options={ENERGY_OPTIONS} value={values.energy_class} onChange={(e) => set('energy_class', e.target.value)} />
              </FormField>
              <FormField label="Riscaldamento">
                <Select options={HEATING_OPTIONS} value={values.heating} onChange={(e) => set('heating', e.target.value)} />
              </FormField>
              <FormField label="Arredato">
                <Select options={FURNISHED_OPTIONS} value={values.furnished} onChange={(e) => set('furnished', e.target.value)} />
              </FormField>
              <FormField label="Ascensore">
                <Select options={ELEVATOR_OPTIONS} value={values.elevator} onChange={(e) => set('elevator', e.target.value)} />
              </FormField>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Prezzo e posizione</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Prezzo (€)">
                <Input type="number" min={0} step="0.01" value={values.price} onChange={(e) => set('price', e.target.value)} />
              </FormField>
              <FormField label="Tipo prezzo">
                <Select options={PRICE_TYPE_OPTIONS} value={values.price_type} onChange={(e) => set('price_type', e.target.value)} />
              </FormField>
              <FormField label="Spese condominiali (€/mese)">
                <Input type="number" min={0} step="0.01" value={values.condo_fees} onChange={(e) => set('condo_fees', e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Latitudine">
                <Input type="number" step="0.00000001" value={values.latitude} onChange={(e) => set('latitude', e.target.value)} />
              </FormField>
              <FormField label="Longitudine">
                <Input type="number" step="0.00000001" value={values.longitude} onChange={(e) => set('longitude', e.target.value)} />
              </FormField>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Dati catastali e APE</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Comune catastale">
                <Input value={values.cadastral_comune} onChange={(e) => set('cadastral_comune', e.target.value)} maxLength={100} placeholder="es. Civitanova Marche" />
              </FormField>
              <FormField label="Categoria">
                <Input value={values.cadastral_category} onChange={(e) => set('cadastral_category', e.target.value)} maxLength={10} placeholder="es. A/2" />
              </FormField>
              <FormField label="Classe">
                <Input value={values.cadastral_class} onChange={(e) => set('cadastral_class', e.target.value)} maxLength={10} placeholder="es. 3" />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Foglio">
                <Input value={values.cadastral_foglio} onChange={(e) => set('cadastral_foglio', e.target.value)} maxLength={20} />
              </FormField>
              <FormField label="Particella">
                <Input value={values.cadastral_particella} onChange={(e) => set('cadastral_particella', e.target.value)} maxLength={20} />
              </FormField>
              <FormField label="Subalterno">
                <Input value={values.cadastral_subalterno} onChange={(e) => set('cadastral_subalterno', e.target.value)} maxLength={20} />
              </FormField>
              <FormField label="Zona OMI">
                <Input value={values.cadastral_zone} onChange={(e) => set('cadastral_zone', e.target.value)} maxLength={20} placeholder="es. B1" />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FormField label="Rendita catastale (€)">
                <Input type="number" min={0} step="0.01" value={values.cadastral_rendita} onChange={(e) => set('cadastral_rendita', e.target.value)} />
              </FormField>
              <FormField label="N. attestato APE">
                <Input value={values.ape_number} onChange={(e) => set('ape_number', e.target.value)} maxLength={50} />
              </FormField>
              <FormField label="Rilascio APE">
                <Input type="date" value={values.ape_issue_date} onChange={(e) => set('ape_issue_date', e.target.value)} />
              </FormField>
              <FormField label="Scadenza APE">
                <Input type="date" value={values.ape_expiry_date} onChange={(e) => set('ape_expiry_date', e.target.value)} />
              </FormField>
            </div>
            <FormField label="IPE (kWh/m²·a)" className="max-w-xs">
              <Input type="number" min={0} step="0.01" value={values.ipe_value} onChange={(e) => set('ipe_value', e.target.value)} />
            </FormField>
            <p className="text-xs text-muted">La scadenza APE si compila da sola a 10 anni dal rilascio se lasciata vuota.</p>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-navy">Descrizione</legend>
            <FormField label="Descrizione">
              <textarea
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </FormField>
            <FormField label="Caratteristiche aggiuntive">
              <textarea
                value={values.additional_features}
                onChange={(e) => set('additional_features', e.target.value)}
                rows={2}
                placeholder="Es. cantina, climatizzazione, infissi nuovi…"
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </FormField>
            <FormField label="Note interne">
              <textarea
                value={values.internal_notes}
                onChange={(e) => set('internal_notes', e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </FormField>
          </fieldset>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/properties')}>
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
