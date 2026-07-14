import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { useSaveSettings } from '../api';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'tel' | 'email' | 'color';
  placeholder?: string;
  full?: boolean;
}

interface Props {
  title: string;
  description?: string;
  section: string;
  fields: Field[];
  values: Record<string, string>;
}

/** Editable settings section: fields hydrated from `values`, saved by section. */
export function SettingsForm({ title, description, section, fields, values }: Props) {
  const save = useSaveSettings();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = values[f.key] ?? '';
    setForm(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const onSave = () => save.mutate({ section, ...form });

  return (
    <Card>
      <div className="mb-4">
        <CardTitle>{title}</CardTitle>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
            <label className="text-eyebrow mb-1.5 block">{f.label}</label>
            {f.type === 'color' ? (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form[f.key] || '#0B3D91'}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-white p-1"
                />
                <Input value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className="flex-1" />
              </div>
            ) : (
              <Input
                type={f.type ?? 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Salva modifiche
        </Button>
        {save.isSuccess && <span className="text-sm font-medium text-success">Salvato ✓</span>}
        {save.isError && (
          <span className="text-sm font-medium text-danger">
            {save.error instanceof ApiError ? save.error.message : 'Errore nel salvataggio'}
          </span>
        )}
      </div>
    </Card>
  );
}
