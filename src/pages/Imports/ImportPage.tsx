import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileSpreadsheet, Keyboard, Plus, Upload, XCircle, CheckCircle2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Notice, PageHeader, Progress } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ValidationBadge } from '@/components/shared/StatusBadge';
import { Stepper } from '@/components/imports/Stepper';
import { SourceDialog } from '@/pages/Sources/SourcesPage';
import { useSources } from '@/hooks/useSources';
import { useToast } from '@/contexts/toast';
import { ParserClient, type ParsedInfo } from '@/services/imports/parserClient';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_ROWS, detectMapping, validateFileMeta, type Analysis, type ColumnMapping, type FileKind } from '@/services/imports/rules';
import { runImport, type ImportProgress } from '@/services/imports/runImport';
import { errorMessage, fmtNumber } from '@/lib/utils';
import { formatPhoneBR } from '@/utils/phone';
import type { ValidationStatus } from '@/types/db';

const STATUS_ORDER: ValidationStatus[] = ['valid', 'foreign', 'needs_review', 'incomplete', 'invalid_area_code', 'invalid'];

export function ImportPage() {
  const [params] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const sources = useSources();
  const parser = useRef<ParserClient | null>(null);
  const abort = useRef<AbortController | null>(null);

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const [manualText, setManualText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind | null>(null);
  const [info, setInfo] = useState<ParsedInfo | null>(null);
  const [sourceId, setSourceId] = useState(params.get('fonte') ?? '');
  const [newSource, setNewSource] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>({ name: null, phone: null, area_code: null });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [confirmLegit, setConfirmLegit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [previousJob, setPreviousJob] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | undefined>();

  useEffect(() => () => parser.current?.terminate(), []);
  const source = useMemo(() => sources.data?.find((s) => s.id === sourceId), [sources.data, sourceId]);

  const reset = () => {
    parser.current?.terminate(); parser.current = null;
    setStep(0); setFile(null); setKind(null); setInfo(null); setAnalysis(null); setProgress(null); setJobId(null);
    setPreviousJob(null); setError(null); setConfirmLegit(false); setManualText(''); setStorageWarning(undefined);
  };

  async function loadFile(f: File) {
    setError(null);
    try {
      const k = validateFileMeta(f.name, f.size);
      setBusy(true);
      parser.current?.terminate();
      parser.current = new ParserClient();
      const parsed = await parser.current.parse(k, await f.arrayBuffer());
      setFile(f); setKind(k); setInfo(parsed);
      setStep(1);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function loadManual() {
    const text = manualText.trim();
    if (!text) { setError('Digite ao menos um contato.'); return; }
    await loadFile(new File([`Nome;Telefone\n${text.split('\n').map((l) => l.includes(';') || l.includes(',') ? l.replace(',', ';') : `;${l}`).join('\n')}`], 'importacao-manual.txt', { type: 'text/plain' }));
  }

  // Se houver contatos pré-carregados do Extrator de WhatsApp
  useEffect(() => {
    const pending = sessionStorage.getItem('gep_pending_import_text');
    if (pending) {
      sessionStorage.removeItem('gep_pending_import_text');
      const groupName = sessionStorage.getItem('gep_pending_group_name') || 'Grupo WhatsApp';
      sessionStorage.removeItem('gep_pending_group_name');
      const cleanName = `whatsapp_${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`;
      loadFile(new File([pending], cleanName, { type: 'text/csv' }));
    }
  }, []);

  // Ao chegar no mapeamento, usa a detecção automática (o usuário pode corrigir)
  useEffect(() => {
    if (step === 3 && info && mapping.phone === null) {
      setMapping(detectMapping({ headers: info.headers, rows: info.sample, hasHeader: info.hasHeader, warnings: [] }));
    }
  }, [step, info, mapping.phone]);

  async function validate() {
    if (!parser.current) return;
    setBusy(true); setError(null);
    try { setAnalysis(await parser.current.analyze(mapping)); setStep(4); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function start() {
    if (!parser.current || !file || !kind || !info || !sourceId) return;
    setStep(7); setBusy(true); setError(null);
    abort.current = new AbortController();
    try {
      const r = await runImport({
        parser: parser.current, file, kind, fileType: mode === 'manual' ? 'manual' : kind, hash: info.hash, sourceId, mapping, total: info.total,
        onJob: (id, prev) => { setJobId(id); setPreviousJob(prev); },
        onProgress: (p) => setProgress(p), signal: abort.current.signal,
      });
      setProgress(r.progress); setStorageWarning(r.storageWarning);
      setStep(8);
      qc.invalidateQueries();
      toast(r.progress.status === 'cancelled' ? 'Importação cancelada' : 'Importação concluída');
    } catch (e) {
      setError(`${errorMessage(e)} Você pode retomar o processamento em Histórico.`);
    } finally { setBusy(false); }
  }

  const colOptions = info?.headers.map((h, i) => <option key={i} value={i}>{h}</option>);
  const pct = progress && progress.total_rows > 0 ? (progress.processed_rows / progress.total_rows) * 100 : 0;

  return (
    <>
      <PageHeader title="Importar contatos" description="CSV, Excel (XLSX/XLS), TXT ou digitação manual. A leitura acontece no seu navegador sem travar a tela; o banco faz a deduplicação." />
      <Stepper current={step} />
      {error && <Notice tone="danger" title="Não foi possível continuar">{error}</Notice>}

      {step === 0 && (
        <Card>
          <CardHeader>
            <div className="flex gap-2">
              <Button variant={mode === 'file' ? 'default' : 'outline'} size="sm" onClick={() => setMode('file')}><FileSpreadsheet /> Arquivo</Button>
              <Button variant={mode === 'manual' ? 'default' : 'outline'} size="sm" onClick={() => setMode('manual')}><Keyboard /> Digitar</Button>
            </div>
          </CardHeader>
          <CardContent>
            {mode === 'file' ? (
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:border-primary hover:bg-accent/30">
                <div className="rounded-full bg-accent p-3 text-accent-foreground"><Upload className="size-5" /></div>
                <div>
                  <p className="font-medium">{busy ? 'Lendo arquivo…' : 'Toque para escolher ou arraste o arquivo aqui'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{ACCEPTED_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')} · até {MAX_FILE_BYTES / 1024 / 1024} MB · até {fmtNumber(MAX_ROWS)} linhas</p>
                </div>
                <input type="file" className="sr-only" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
              </label>
            ) : (
              <div className="grid gap-3">
                <Field label="Um contato por linha" htmlFor="manual" hint="Formato: Nome;Telefone — ou apenas o telefone.">
                  <Textarea id="manual" rows={8} className="font-mono" placeholder={'Maria Silva;(84) 98765-4321\nJoão;11 99999-9999'} value={manualText} onChange={(e) => setManualText(e.target.value)} />
                </Field>
                <div><Button onClick={loadManual} loading={busy}>Continuar</Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && info && (
        <Card>
          <CardHeader><CardTitle>De onde vieram estes contatos?</CardTitle><CardDescription>{file?.name} · {fmtNumber(info.total)} registros</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Fonte" htmlFor="source">
                <Select id="source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="sm:w-80">
                  <option value="">Selecione…</option>
                  {sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Button variant="outline" onClick={() => setNewSource(true)}><Plus /> Nova fonte</Button>
            </div>
            <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!sourceId} />
          </CardContent>
        </Card>
      )}

      {step === 2 && info && (
        <Card>
          <CardHeader><CardTitle>Visualizar dados</CardTitle><CardDescription>Primeiras linhas como estão no arquivo{info.hasHeader ? ' (cabeçalho detectado)' : ' (sem cabeçalho)'}.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            {info.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
            <Table>
              <THead><TR>{info.headers.map((h, i) => <TH key={i}>{h}</TH>)}</TR></THead>
              <TBody>{info.sample.map((r, i) => <TR key={i}>{info.headers.map((_, j) => <TD key={j} className="max-w-48 truncate">{r[j]}</TD>)}</TR>)}</TBody>
            </Table>
            <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} />
          </CardContent>
        </Card>
      )}

      {step === 3 && info && (
        <Card>
          <CardHeader><CardTitle>Mapear colunas</CardTitle><CardDescription>Detectamos as colunas automaticamente. Corrija se necessário.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {(['phone', 'name', 'area_code'] as const).map((k) => (
                <Field key={k} htmlFor={`map-${k}`} label={k === 'phone' ? 'Telefone → phone (obrigatório)' : k === 'name' ? 'Nome → name' : 'DDD → area_code (se separado)'}>
                  <Select id={`map-${k}`} value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">{k === 'phone' ? 'Selecione…' : 'Não usar'}</option>
                    {colOptions}
                  </Select>
                </Field>
              ))}
            </div>
            <Notice>Somente nome e telefone são importados. Outras colunas são descartadas (minimização de dados — LGPD).</Notice>
            <Nav onBack={() => setStep(2)} onNext={validate} nextDisabled={mapping.phone === null} loading={busy} nextLabel="Validar registros" />
          </CardContent>
        </Card>
      )}

      {step === 4 && analysis && (
        <Card>
          <CardHeader><CardTitle>Validação</CardTitle><CardDescription>Resultado da normalização de {fmtNumber(analysis.total)} registros.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Telefones utilizáveis" value={analysis.usable} />
              <Stat label="Únicos no arquivo" value={analysis.uniqueInFile} />
              <Stat label="Repetidos no arquivo" value={analysis.duplicatesInFile} />
              <Stat label="Sem nome" value={analysis.missingName} />
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.filter((s) => analysis.byStatus[s]).map((s) => <span key={s} className="flex items-center gap-1.5"><ValidationBadge s={s} /><span className="text-sm tabular-nums">{fmtNumber(analysis.byStatus[s])}</span></span>)}
              {analysis.byStatus.empty ? <Badge>Vazio: {fmtNumber(analysis.byStatus.empty)}</Badge> : null}
            </div>
            {analysis.problems.length > 0 && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Ver registros com problema ({fmtNumber(analysis.total - analysis.usable)})</summary>
                <Table className="mt-3">
                  <THead><TR><TH>Linha</TH><TH>Telefone original</TH><TH>Situação</TH><TH>Motivo</TH></TR></THead>
                  <TBody>{analysis.problems.slice(0, 50).map((p) => (
                    <TR key={p.rowNumber}><TD>{p.rowNumber}</TD><TD className="font-mono">{p.phone || '—'}</TD><TD>{p.status === 'empty' ? <Badge>Vazio</Badge> : <ValidationBadge s={p.status as ValidationStatus} />}</TD><TD className="text-muted-foreground">{p.issues.join('; ')}</TD></TR>
                  ))}</TBody>
                </Table>
              </details>
            )}
            <Notice>Número válido significa número bem formado. Isso não confirma que o número tem WhatsApp.</Notice>
            <Nav onBack={() => setStep(3)} onNext={() => setStep(5)} nextDisabled={analysis.usable === 0 && analysis.total - (analysis.byStatus.empty ?? 0) === 0} />
          </CardContent>
        </Card>
      )}

      {step === 5 && analysis && (
        <Card>
          <CardHeader><CardTitle>Prévia</CardTitle><CardDescription>Como os primeiros registros serão gravados.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <THead><TR><TH>#</TH><TH>Nome</TH><TH>Original</TH><TH>Normalizado</TH><TH>Situação</TH></TR></THead>
              <TBody>{analysis.preview.map((p) => (
                <TR key={p.rowNumber}>
                  <TD className="text-muted-foreground">{p.rowNumber}</TD><TD>{p.name ?? <span className="text-muted-foreground">—</span>}</TD>
                  <TD className="font-mono text-xs">{p.phone}</TD><TD className="font-mono text-xs">{p.normalized ? formatPhoneBR(p.normalized) : '—'}</TD>
                  <TD className="flex flex-wrap gap-1">{p.status === 'empty' ? <Badge>Vazio</Badge> : <ValidationBadge s={p.status as ValidationStatus} />}{p.duplicateInFile && <Badge tone="warning">Repetido</Badge>}</TD>
                </TR>
              ))}</TBody>
            </Table>
            <Nav onBack={() => setStep(4)} onNext={() => setStep(6)} />
          </CardContent>
        </Card>
      )}

      {step === 6 && analysis && info && (
        <Card>
          <CardHeader><CardTitle>Confirmar importação</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row k="Arquivo" v={file?.name ?? ''} /><Row k="Fonte" v={source?.name ?? ''} />
              <Row k="Registros" v={fmtNumber(info.total)} /><Row k="Telefones utilizáveis" v={fmtNumber(analysis.usable)} />
            </dl>
            <Notice tone="warning" title="Autorização não é automática">
              Todos os contatos entram como “Pendente de comprovação”. Eles só poderão receber convites depois que você registrar a autorização de cada um.
            </Notice>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={confirmLegit} onChange={(e) => setConfirmLegit(e.target.checked)} />
              Confirmo que esta lista foi obtida de forma legítima, com finalidade definida, e não foi extraída de grupos sem autorização.
            </label>
            <Nav onBack={() => setStep(5)} onNext={start} nextDisabled={!confirmLegit} nextLabel="Importar agora" />
          </CardContent>
        </Card>
      )}

      {step === 7 && (
        <Card>
          <CardHeader><CardTitle>Processando…</CardTitle><CardDescription>Você pode navegar pelo sistema; se fechar a página, retome em Histórico.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Progress value={pct} label="Progresso da importação" />
            <p className="text-sm tabular-nums text-muted-foreground">
              {fmtNumber(progress?.processed_rows ?? 0)} de {fmtNumber(info?.total ?? 0)} registros · {Math.floor(pct)}%
            </p>
            {previousJob && <Notice>Este mesmo arquivo já foi importado antes. Nenhum contato será duplicado; o histórico desta nova importação será registrado.</Notice>}
            <div><Button variant="outline" disabled={!busy} onClick={() => abort.current?.abort()}><XCircle /> Cancelar importação</Button></div>
          </CardContent>
        </Card>
      )}

      {step === 8 && progress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {progress.status === 'completed' ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-muted-foreground" />}
              {progress.status === 'completed' ? 'Importação concluída' : 'Importação cancelada'}
            </CardTitle>
            <CardDescription>{file?.name} → {source?.name}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Registros lidos" value={progress.total_rows} />
              <Stat label="Processados" value={progress.processed_rows} />
              <Stat label="Contatos novos" value={progress.new_contacts} />
              <Stat label="Já existiam (duplicados)" value={progress.duplicate_rows} />
              <Stat label="Inválidos" value={progress.invalid_rows} />
              <Stat label="Conflitos de nome" value={progress.name_conflicts} />
            </div>
            {storageWarning && <Notice tone="warning">{storageWarning}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Link to="/contatos" className={buttonVariants()}>Ver contatos</Link>
              {progress.duplicate_rows > 0 && <Link to="/duplicidades" className={buttonVariants({ variant: 'outline' })}>Revisar duplicidades</Link>}
              <Button variant="outline" onClick={reset}>Nova importação</Button>
            </div>
            {jobId && <p className="text-xs text-muted-foreground">Código da importação: {jobId}</p>}
          </CardContent>
        </Card>
      )}

      <SourceDialog open={newSource} onClose={() => setNewSource(false)} onSaved={(s) => setSourceId(s.id)} />
    </>
  );
}

function Nav({ onBack, onNext, nextDisabled, nextLabel = 'Continuar', loading }: { onBack: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string; loading?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
      <Button variant="ghost" onClick={onBack}><ArrowLeft /> Voltar</Button>
      <Button onClick={onNext} disabled={nextDisabled} loading={loading}>{nextLabel} <ArrowRight /></Button>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmtNumber(value)}</p></div>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
);
