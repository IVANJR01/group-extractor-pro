import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtNumber } from '@/lib/utils';
import { CONSENT_LABEL } from '@/utils/labels';
import type { DashboardData } from '@/types/db';

const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;
const tip = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' },
  formatter: (v: unknown) => fmtNumber(Number(v)),
} as const;
const day = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);
const H = 220;

export function ImportsChart({ data }: { data: DashboardData['imports_by_day'] }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="gImp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="day" tickFormatter={day} {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} labelFormatter={(l) => day(String(l))} />
        <Area type="monotone" dataKey="rows" name="Linhas importadas" stroke="var(--primary)" fill="url(#gImp)" strokeWidth={2} />
        <Area type="monotone" dataKey="new" name="Contatos novos" stroke="#0ea5e9" fill="transparent" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({ data, k, label }: { data: Record<string, string | number>[]; k: string; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(H, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={k} width={110} {...axis} tick={{ fill: 'var(--foreground)', fontSize: 12 }} />
        <Tooltip {...tip} cursor={{ fill: 'var(--muted)' }} />
        <Bar dataKey="contacts" name={label} fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DuplicatesChart({ data }: { data: DashboardData['duplicates_by_import'] }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        {grid}
        <XAxis dataKey="file" {...axis} tickFormatter={(f: string) => (f.length > 12 ? f.slice(0, 11) + '…' : f)} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} cursor={{ fill: 'var(--muted)' }} />
        <Bar dataKey="duplicates" name="Duplicidades" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function JoinsChart({ data }: { data: DashboardData['joins_by_day'] }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        {grid}
        <XAxis dataKey="day" tickFormatter={day} {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} labelFormatter={(l) => day(String(l))} />
        <Line type="monotone" dataKey="shared" name="Convites compartilhados" stroke="#0ea5e9" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="joined" name="Entradas confirmadas" stroke="var(--primary)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const CONSENT_COLORS: Record<string, string> = { authorized: '#16a34a', pending: '#f59e0b', revoked: '#ef4444', blocked: '#7f1d1d' };

export function ConsentChart({ data }: { data: DashboardData['consent_distribution'] }) {
  const rows = data.map((d) => ({ ...d, label: CONSENT_LABEL[d.status]?.[0] ?? d.status }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ResponsiveContainer width="100%" height={H} className="sm:max-w-[55%]">
        <PieChart>
          <Pie data={rows} dataKey="contacts" nameKey="label" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="var(--card)">
            {rows.map((r) => <Cell key={r.status} fill={CONSENT_COLORS[r.status]} />)}
          </Pie>
          <Tooltip {...tip} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="grid w-full gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: CONSENT_COLORS[r.status] }} />{r.label}</span>
            <span className="font-medium tabular-nums">{fmtNumber(r.contacts)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
