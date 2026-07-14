import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { usePropertiesReport, usePaymentsReport, useExpensesReport } from './api';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const STATUS_LABEL: Record<string, string> = { available: 'Disponibili', rented: 'Affittati', sold: 'Venduti', reserved: 'Riservati' };
const PIE_COLORS = ['#0B3D91', '#4A90D9', '#22C55E', '#F97316', '#8B5CF6', '#EF4444'];

const TOOLTIP = { borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 13 } as const;

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

export default function ReportsPage() {
  const props = usePropertiesReport();
  const pay = usePaymentsReport();
  const exp = useExpensesReport();

  const loading = props.isLoading || pay.isLoading || exp.isLoading;

  const paymentSeries = (pay.data?.months ?? []).map((m) => ({
    label: MONTHS[m.month - 1] ?? String(m.month),
    Atteso: m.expected,
    Incassato: m.collected,
  }));
  const statusPie = (props.data?.by_status ?? []).map((s) => ({ name: STATUS_LABEL[s.status] ?? s.status, value: s.total }));
  const typeBars = (props.data?.by_type ?? []).map((t) => ({ name: t.property_type, value: t.total }));
  const expenseBars = (exp.data?.by_category ?? []).map((c) => ({ name: c.category, value: Number(c.total) }));

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Report" subtitle="Analisi e statistiche" />
        <Skeleton className="h-80 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Report" subtitle="Analisi e statistiche" />

      <ChartCard title={`Incassi ${pay.data?.year ?? ''} — atteso vs incassato`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={paymentSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F8" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: '#6B7280' }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Atteso" fill="#4A90D9" radius={[6, 6, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="Incassato" fill="#0B3D91" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Immobili per stato">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2} isAnimationActive={false}>
                {statusPie.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Spese per categoria">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={expenseBars} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F8" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP} />
              <Bar dataKey="value" fill="#F97316" radius={[0, 6, 6, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Immobili per tipologia">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={typeBars} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F8" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
            <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 12, fill: '#6B7280' }} />
            <Tooltip contentStyle={TOOLTIP} />
            <Bar dataKey="value" fill="#0B3D91" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
