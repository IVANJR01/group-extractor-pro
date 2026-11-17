import { useSources } from '@/hooks/useSources';
import { useGroups } from '@/hooks/useGroups';
import { Field, Input, Select } from '@/components/ui/input';
import { CONSENT_LABEL, VALIDATION_LABEL } from '@/utils/labels';
import { DDD_TO_UF, isValidDDD } from '@/utils/ddd';
import { cn } from '@/lib/utils';
import type { ConsentStatus, SegmentFilter, ValidationStatus } from '@/types/db';

const UFS = Array.from(new Set(Object.values(DDD_TO_UF))).sort();

function Chips<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T[] | undefined; onChange: (v: T[]) => void }) {
  const set = new Set(value ?? []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={set.has(v)}
          onClick={() => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); onChange([...n]); }}
          className={cn('min-h-9 rounded-full border px-3 text-xs font-medium transition-colors', set.has(v) ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted')}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Formulário de filtros usado na Central de contatos e na Segmentação. */
export function FilterPanel({ value, onChange }: { value: SegmentFilter; onChange: (f: SegmentFilter) => void }) {
  const sources = useSources(true);
  const groups = useGroups();
  const set = <K extends keyof SegmentFilter>(k: K, v: SegmentFilter[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-sm font-medium">Origem</p>
        <Chips options={(sources.data ?? []).map((s) => [s.id, s.name] as [string, string])} value={value.source_ids} onChange={(v) => set('source_ids', v)} />
        {(value.source_ids?.length ?? 0) > 1 && (
          <Select aria-label="Combinação de origens" value={value.source_match ?? 'any'} onChange={(e) => set('source_match', e.target.value as 'any' | 'all')} className="sm:w-72">
            <option value="any">Em qualquer uma das origens</option>
            <option value="all">Presente em todas as origens</option>
          </Select>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="DDD" htmlFor="f-ddd" hint="Separe por vírgula. Ex.: 84, 11">
          <Input id="f-ddd" inputMode="numeric" defaultValue={value.area_codes?.join(', ') ?? ''}
            onBlur={(e) => set('area_codes', e.target.value.split(/[,\s]+/).map((s) => s.trim()).filter(isValidDDD))} />
        </Field>
        <Field label="Estado (pelo DDD)" htmlFor="f-uf">
          <Select id="f-uf" value={value.ufs?.[0] ?? ''} onChange={(e) => set('ufs', e.target.value ? [e.target.value] : [])}>
            <option value="">Todos</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Autorização</p>
        <Chips options={(Object.keys(CONSENT_LABEL) as ConsentStatus[]).map((k) => [k, CONSENT_LABEL[k][0]])} value={value.consent_statuses} onChange={(v) => set('consent_statuses', v)} />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Validação do telefone</p>
        <Chips options={(['valid', 'foreign', 'needs_review', 'incomplete', 'invalid_area_code', 'invalid'] as ValidationStatus[]).map((k) => [k, VALIDATION_LABEL[k][0]])}
          value={value.validation_statuses} onChange={(v) => set('validation_statuses', v)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cadastrado a partir de" htmlFor="f-from"><Input id="f-from" type="date" value={value.imported_from ?? ''} onChange={(e) => set('imported_from', e.target.value)} /></Field>
        <Field label="Cadastrado até" htmlFor="f-to"><Input id="f-to" type="date" value={value.imported_to ?? ''} onChange={(e) => set('imported_to', e.target.value)} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Histórico de convites" htmlFor="f-inv">
          <Select id="f-inv" value={value.invite_status ?? ''} onChange={(e) => set('invite_status', (e.target.value || undefined) as SegmentFilter['invite_status'])}>
            <option value="">Todos</option>
            <option value="never">Ainda não receberam convite</option>
            <option value="invited">Já tiveram convite registrado</option>
          </Select>
        </Field>
        <Field label="Grupo de destino" htmlFor="f-group">
          <Select id="f-group" value={value.destination_group_id ?? ''} onChange={(e) => set('destination_group_id', e.target.value || undefined)}>
            <option value="">Todos</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!value.include_suppressed} onChange={(e) => set('include_suppressed', e.target.checked)} />
        Mostrar também bloqueados e da lista de supressão
      </label>
    </div>
  );
}

export function countActiveFilters(f: SegmentFilter): number {
  return Object.entries(f).filter(([k, v]) => k !== 'search' && k !== 'source_match' && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)).length;
}
