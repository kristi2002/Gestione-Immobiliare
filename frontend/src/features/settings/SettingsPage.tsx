import { Mail, MessageCircle, Facebook, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSettings, isEnabled } from './api';
import { SettingsForm, type Field } from './components/SettingsForm';
import { IntegrationCard } from './components/IntegrationCard';

const BRANDING_FIELDS: Field[] = [
  { key: 'agency_name', label: 'Nome agenzia', full: true },
  { key: 'agency_tagline', label: 'Slogan', full: true },
  { key: 'agency_phone', label: 'Telefono', type: 'tel' },
  { key: 'agency_address', label: 'Indirizzo' },
  { key: 'primary_color', label: 'Colore primario', type: 'color' },
  { key: 'sidebar_color', label: 'Colore sidebar', type: 'color' },
];

const FISCAL_FIELDS: Field[] = [
  { key: 'agency_denominazione', label: 'Denominazione', full: true },
  { key: 'agency_piva', label: 'Partita IVA' },
  { key: 'agency_cf', label: 'Codice Fiscale' },
  { key: 'agency_pec', label: 'PEC', type: 'email' },
  { key: 'agency_regime_fiscale', label: 'Regime fiscale' },
  { key: 'agency_iban', label: 'IBAN', full: true },
];

function has(v: string | undefined): boolean {
  return !!v && v.trim() !== '' && !v.startsWith('••••');
}

export default function SettingsPage() {
  const { data, isLoading, isError, refetch } = useSettings();

  if (isError) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Impostazioni" subtitle="Configurazione dell'agenzia" />
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Impostazioni" subtitle="Configurazione dell'agenzia" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const { branding, mail, whatsapp, meta, backup, fatturazione, twofa } = data;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Impostazioni" subtitle="Configurazione dell'agenzia" />

      <SettingsForm
        title="Anagrafica e Branding"
        description="Nome, contatti e colori dell'applicazione."
        section="branding"
        fields={BRANDING_FIELDS}
        values={branding as unknown as Record<string, string>}
      />

      <SettingsForm
        title="Dati Fiscali"
        description="Dati per la fatturazione elettronica e i pagamenti SEPA."
        section="fatturazione"
        fields={FISCAL_FIELDS}
        values={fatturazione}
      />

      <div>
        <h2 className="mb-4 text-card-title text-navy">Integrazioni</h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <IntegrationCard
            icon={Mail}
            title="Email (SMTP)"
            description="Invio email transazionali"
            enabled={isEnabled(mail.mail_enabled)}
            configured={has(mail.smtp_host)}
            details={[
              { label: 'Server', value: mail.smtp_host ?? '' },
              { label: 'Mittente', value: mail.agency_email ?? '' },
            ]}
          />
          <IntegrationCard
            icon={MessageCircle}
            title="WhatsApp (Twilio)"
            description="Messaggistica inquilini"
            enabled={isEnabled(whatsapp.whatsapp_enabled)}
            configured={has(whatsapp.twilio_account_sid)}
            details={[{ label: 'Numero', value: whatsapp.twilio_whatsapp_from ?? '' }]}
          />
          <IntegrationCard
            icon={Facebook}
            title="Meta / Social"
            description="Pubblicazione sui social"
            enabled={has(meta.meta_app_id)}
            configured={has(meta.meta_app_id)}
            details={[{ label: 'App ID', value: meta.meta_app_id ?? '' }]}
          />
          <IntegrationCard
            icon={DatabaseBackup}
            title="Backup Cloud (S3)"
            description="Copie di sicurezza off-site"
            enabled={isEnabled(backup.backup_cloud_enabled)}
            configured={has(backup.backup_s3_bucket)}
            details={[
              { label: 'Bucket', value: backup.backup_s3_bucket ?? '' },
              { label: 'Regione', value: backup.backup_s3_region ?? '' },
            ]}
          />
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <CardTitle>Autenticazione a due fattori</CardTitle>
              <p className="text-xs text-muted">Livello di sicurezza aggiuntivo per l'accesso admin.</p>
            </div>
          </div>
          <Badge variant={isEnabled(twofa.enabled) ? 'success' : 'neutral'}>
            {isEnabled(twofa.enabled) ? 'Attiva' : 'Non attiva'}
          </Badge>
        </div>
      </Card>
    </div>
  );
}
