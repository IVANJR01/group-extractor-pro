import { useState, useEffect } from 'react';
import {
  Smartphone,
  Check,
  Zap,
  RefreshCw,
  QrCode,
  Play,
  Pause,
  Square,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Loader2,
  Plug,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/contexts/toast';
import type { SavedContact } from '@/services/localExtractorStorage';

interface ChipData {
  index: number;
  id: string;
  name: string;
  phone: string;
  isMain: boolean;
  status: 'disconnected' | 'connecting' | 'qrcode' | 'pairing_code' | 'connected';
  qrCodeDataUrl: string | null;
  pairingCode: string | null;
  addedToday: number;
  error: string | null;
  lastSeen: string | null;
}

interface ActiveTaskData {
  isRunning: boolean;
  isPaused: boolean;
  currentIndex: number;
  totalContacts: number;
  successCount: number;
  failedCount: number;
  currentChip: string | null;
  currentContact: string | null;
  nextAdditionInSeconds: number;
  groupName: string;
  groupJid: string;
}

interface RobotLogData {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface WhatsAppMultiChipRobotProps {
  destinationUrl: string;
  destinationName: string;
  contacts: SavedContact[];
  onRemoveDuplicates?: () => void;
  duplicateCount?: number;
}

export function WhatsAppMultiChipRobot({
  destinationUrl,
  destinationName,
  contacts,
  onRemoveDuplicates,
  duplicateCount = 0,
}: WhatsAppMultiChipRobotProps) {
  const toast = useToast();

  const [chips, setChips] = useState<ChipData[]>([]);
  const [activeTask, setActiveTask] = useState<ActiveTaskData | null>(null);
  const [logs, setLogs] = useState<RobotLogData[]>([]);
  const [selectedChipIndex, setSelectedChipIndex] = useState<number>(0);

  // Estados de formulário de conexão
  const [pairingPhone, setPairingPhone] = useState('');
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Parâmetros de execução anti-ban
  const [dailyLimit, setDailyLimit] = useState<number>(20);
  const [delaySeconds, setDelaySeconds] = useState<number>(20);
  const [isStartingTask, setIsStartingTask] = useState(false);

  // Polling de status do robô a cada 2 segundos
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/robot/status');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data && data.chips) {
            setChips(data.chips);
            setActiveTask(data.activeTask);
            setLogs(data.logs || []);
          }
        }
      }
    } catch {
      // Ignora erro de rede temporário
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const activeChip = chips[selectedChipIndex] || chips[0] || {
    index: 0,
    id: 'chip-1',
    name: 'WhatsApp 1',
    phone: '',
    isMain: true,
    status: 'disconnected',
    qrCodeDataUrl: null,
    pairingCode: null,
    addedToday: 0,
    error: null,
    lastSeen: null,
  };

  // CONECTAR POR CÓDIGO DE EMPARELHAMENTO (SEM CÂMERA)
  const handleGeneratePairingCode = async () => {
    let clean = pairingPhone.replace(/\D/g, '');
    if (clean.length < 10) {
      toast('Por favor, informe um número de telefone com DDD válido. Ex: 4398370727 ou 554398370727', 'error');
      return;
    }

    // Auto-adicionar código do Brasil (55) se o número tiver 10-11 dígitos
    if (clean.length <= 11 && !clean.startsWith('55')) {
      clean = '55' + clean;
      toast(`📱 Código do país 55 adicionado automaticamente → ${clean}`, 'info');
    }

    setIsGeneratingCode(true);
    try {
      const res = await fetch('/api/robot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chipIndex: selectedChipIndex,
          phone: clean,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Falha ao solicitar código');
      }

      toast(`⚡ Código gerado para ${clean}! Digite no WhatsApp do celular.`, 'info');
      fetchStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao gerar código de emparelhamento', 'error');
    } finally {
      setIsGeneratingCode(false);
    }
  };

  // CONECTAR POR QR CODE
  const handleRequestQrCode = async () => {
    setIsLoadingQr(true);
    try {
      const res = await fetch('/api/robot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chipIndex: selectedChipIndex,
          phone: null,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Falha ao iniciar QR Code');
      }

      toast('📷 Aguardando leitura do QR Code...', 'info');
      fetchStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao iniciar QR Code', 'error');
    } finally {
      setIsLoadingQr(false);
    }
  };

  // DESCONECTAR CHIP SELECIONADO
  const handleDisconnectSelected = async () => {
    try {
      const res = await fetch('/api/robot/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipIndex: selectedChipIndex }),
      });
      if (res.ok) {
        toast(`🔌 WhatsApp ${activeChip.name} desconectado.`, 'info');
        fetchStatus();
      }
    } catch {
      toast('Erro ao desconectar WhatsApp.', 'error');
    }
  };

  // DESCONECTAR TODOS OS CHIPS
  const handleDisconnectAll = async () => {
    if (window.confirm('Deseja desconectar todos os WhatsApps do robô?')) {
      try {
        const res = await fetch('/api/robot/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        if (res.ok) {
          toast('🔌 Todos os WhatsApps foram desconectados.', 'info');
          fetchStatus();
        }
      } catch {
        toast('Erro ao desconectar robôs.', 'error');
      }
    }
  };

  // INICIAR TAREFA DE ADIÇÃO AUTOMÁTICA
  const handleStartAdding = async () => {
    if (!destinationUrl) {
      toast('Informe o link do grupo de destino antes de iniciar.', 'error');
      return;
    }

    const connectedChips = chips.filter((c) => c.status === 'connected');
    if (connectedChips.length === 0) {
      toast('Conecte pelo menos 1 WhatsApp no robô para iniciar.', 'error');
      return;
    }

    // Auto-exclusão de duplicados e validação estrita de telefones reais (descarta LIDs do WhatsApp)
    const cleanContactsMap = new Map();
    let lidCount = 0;

    for (const c of contacts) {
      let digits = (c.digits || c.phone || '').replace(/\D/g, '');

      // Caso 1: Com DDI 55 (12 ou 13 dígitos)
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        const ddd = parseInt(digits.slice(2, 4), 10);
        if (ddd < 11 || ddd > 99) {
          lidCount++;
          continue;
        }
      }
      // Caso 2: Sem DDI 55 (10 ou 11 dígitos com DDD válido)
      else if (digits.length === 10 || digits.length === 11) {
        const ddd = parseInt(digits.slice(0, 2), 10);
        if (ddd >= 11 && ddd <= 99) {
          digits = '55' + digits;
        } else {
          lidCount++;
          continue;
        }
      }
      // Qualquer outro caso (12-16 dígitos sem 55, como LIDs criptográficos) é descartado
      else {
        lidCount++;
        continue;
      }

      if (!cleanContactsMap.has(digits)) {
        cleanContactsMap.set(digits, {
          name: c.name && !/^(não|nao|sim|admin|membro)$/i.test(c.name.trim()) ? c.name : '',
          digits,
          phone: digits,
        });
      }
    }

    const uniqueList = Array.from(cleanContactsMap.values());
    if (uniqueList.length === 0) {
      if (lidCount > 0) {
        toast(`Os contatos da lista são IDs de privacidade (LID) e não telefones reais. Importe uma lista com telefones reais ou extraia novamente abrindo os membros no WhatsApp Web.`, 'error');
      } else {
        toast('Nenhum contato com número de telefone válido encontrado para adicionar.', 'error');
      }
      return;
    }

    if (lidCount > 0) {
      toast(`ℹ️ ${lidCount} contatos com ID de privacidade foram ignorados para evitar erro 404.`, 'info');
    }

    setIsStartingTask(true);
    try {
      const res = await fetch('/api/robot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupUrl: destinationUrl,
          contacts: uniqueList,
          delaySeconds,
          dailyLimit,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Falha ao iniciar robô');
      }

      toast(`🚀 Robô iniciado com sucesso! Adicionando contatos com revezamento seguro.`, 'info');
      fetchStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao iniciar robô de adição', 'error');
    } finally {
      setIsStartingTask(false);
    }
  };

  const handlePauseTask = async () => {
    await fetch('/api/robot/pause', { method: 'POST' });
    fetchStatus();
    toast('⏸️ Adição pausada.', 'info');
  };

  const handleResumeTask = async () => {
    await fetch('/api/robot/resume', { method: 'POST' });
    fetchStatus();
    toast('▶️ Adição retomada.', 'info');
  };

  const handleStopTask = async () => {
    if (window.confirm('Tem certeza que deseja interromper a adição automática?')) {
      await fetch('/api/robot/stop', { method: 'POST' });
      fetchStatus();
      toast('⏹️ Adição interrompida.', 'info');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
      toast('Código copiado!', 'info');
    });
  };

  const connectedCount = chips.filter((c) => c.status === 'connected').length;

  return (
    <div className="space-y-6">
      {/* ============================================================== */}
      {/* CARD PRINCIPAL: WHATSAPPS DO ROBÔ (MULTI-CHIP)                 */}
      {/* EXATAMENTE CONFORME SCREENSHOTS DO USUÁRIO                     */}
      {/* ============================================================== */}
      <Card className="bg-[#111827] border-slate-800 text-slate-100 shadow-xl overflow-hidden">
        {/* CABEÇALHO */}
        <CardHeader className="p-5 pb-3 border-b border-slate-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📱</span>
              <CardTitle className="text-lg font-bold text-white tracking-wide">
                WhatsApps do Robô (Multi-Chip)
              </CardTitle>
            </div>

            <button
              onClick={handleDisconnectAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer"
            >
              <Plug className="h-3.5 w-3.5" />
              Desconectar
            </button>
          </div>

          {/* LISTA DE CHIPS CONECTADOS (ROW DE BADGES CONFORME SCREENSHOT) */}
          <div className="flex items-center gap-2 overflow-x-auto pt-4 pb-1">
            {chips.map((chip, idx) => {
              const isSelected = selectedChipIndex === idx;
              const isConnected = chip.status === 'connected';

              return (
                <button
                  key={chip.id}
                  onClick={() => setSelectedChipIndex(idx)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all shrink-0 border ${
                    isSelected
                      ? 'bg-slate-800/90 border-amber-400/80 text-white shadow-sm ring-1 ring-amber-400/50'
                      : isConnected
                      ? 'bg-slate-800/40 border-slate-700/80 text-slate-200 hover:bg-slate-800/70'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {/* Ponto de status verde brilhante */}
                  {isConnected ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_#34d399]" />
                  ) : chip.status === 'connecting' || chip.status === 'pairing_code' ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-slate-500 inline-block" />
                  )}

                  {/* Número de telefone ou identificador */}
                  <span className="font-mono font-semibold">
                    {chip.phone ? chip.phone : `Chip ${idx + 1}`}
                  </span>

                  {/* Tag (Principal) em amarelo conforme screenshot */}
                  {chip.isMain && (
                    <span className="text-amber-400 font-bold ml-0.5">
                      (Principal)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardHeader>

        {/* CORPO DO CARD DO CHIP SELECIONADO */}
        <CardContent className="p-6 space-y-6">
          {typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && (
            <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-200 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-white block mb-0.5">💡 Acessando a Versão em Nuvem (Vercel)</span>
                O Robô Multi-Chip WhatsApp (Baileys) roda diretamente no seu computador para usar sua conexão local e proteger seus chips contra restrições de IP de nuvem. Para conectar os WhatsApps e rodar as adições automáticas, abra o sistema com o <code>iniciar.bat</code> ou acesse <strong>http://localhost:5173/</strong>.
              </div>
            </div>
          )}

          {/* SE O CHIP ATUAL ESTÁ CONECTADO */}
          {activeChip.status === 'connected' ? (
            <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 text-center space-y-3">
              {/* Círculo verde com checkmark gigante */}
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_24px_rgba(16,185,129,0.2)]">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>

              {/* Título: "554376089192 Conectado!" */}
              <h3 className="text-xl font-bold text-white tracking-tight">
                {activeChip.phone || 'WhatsApp'} Conectado!
              </h3>

              {/* Número ativo */}
              <p className="text-sm text-slate-400">
                Número ativo: <strong className="text-slate-200 font-mono">{activeChip.phone}</strong>
              </p>

              {/* Badge "Conectado e revezando nos envios" */}
              <div className="pt-1">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin-slow" />
                  Conectado e revezando nos envios
                </div>
              </div>

              {/* Desconectar chip individual */}
              <div className="pt-2">
                <button
                  onClick={handleDisconnectSelected}
                  className="text-xs text-rose-400/80 hover:text-rose-300 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plug className="h-3 w-3" /> Desconectar este número
                </button>
              </div>
            </div>
          ) : (
            /* SE O CHIP ATUAL ESTÁ DESCONECTADO OU EM PROCESSO DE CONEXÃO */
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                <Smartphone className="h-8 w-8 text-slate-400 mx-auto opacity-80" />
                <h4 className="text-base font-bold text-white">
                  Conectar {activeChip.name} {activeChip.isMain && '(Principal)'}
                </h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Você pode conectar digitando seu número de telefone (sem câmera) ou apontando a câmera para o QR Code.
                </p>
              </div>

              {/* EXIBIÇÃO DE CÓDIGO DE EMPARELHAMENTO GERADO */}
              {activeChip.pairingCode && (
                <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-3 animate-in fade-in">
                  <div className="text-xs uppercase font-bold tracking-wider text-amber-400">
                    Código de Emparelhamento do WhatsApp
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-3xl font-mono font-extrabold tracking-widest text-white bg-slate-950/80 px-6 py-2.5 rounded-xl border border-amber-400/40 shadow-inner">
                      {activeChip.pairingCode}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(activeChip.pairingCode || '')}
                      className="border-amber-400/40 text-amber-300 hover:bg-amber-400/20"
                    >
                      {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-amber-200/90 leading-relaxed max-w-lg mx-auto">
                    No seu celular: Abra o <strong>WhatsApp &gt; Aparelhos Conectados &gt; Conectar um aparelho &gt; Conectar com número de telefone</strong> e digite o código de 8 dígitos acima.
                  </p>
                </div>
              )}

              {/* EXIBIÇÃO DE QR CODE */}
              {activeChip.qrCodeDataUrl && !activeChip.pairingCode && (
                <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center space-y-3">
                  <div className="text-xs uppercase font-bold tracking-wider text-emerald-400">
                    Aponte a Câmera do WhatsApp
                  </div>
                  <div className="inline-block p-3 bg-white rounded-xl shadow-lg">
                    <img
                      src={activeChip.qrCodeDataUrl}
                      alt="QR Code WhatsApp"
                      className="w-48 h-48 mx-auto"
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    Abra o WhatsApp no celular &gt; Aparelhos Conectados &gt; Conectar um aparelho e aponte para a tela.
                  </p>
                </div>
              )}

              {/* BOTÕES DE ESCOLHA DE CONEXÃO SE AINDA NÃO GEROU */}
              {!activeChip.pairingCode && !activeChip.qrCodeDataUrl && (
                <div className="flex justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRequestQrCode}
                    disabled={isLoadingQr}
                    className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 gap-2 text-xs"
                  >
                    {isLoadingQr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
                    Conectar via QR Code (Câmera)
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* SEÇÃO "OU CONECTE DIGITANDO O NÚMERO (SEM CÂMERA)"             */}
          {/* EXATAMENTE CONFORME SCREENSHOT DO USUÁRIO                      */}
          {/* ============================================================== */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400 fill-amber-400" />
              Ou conecte digitando o número (Sem Câmera):
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                placeholder="Ex: 4398370727 (o 55 é adicionado automático)"
                value={pairingPhone}
                onChange={(e) => setPairingPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGeneratePairingCode()}
                className="flex-1 px-3.5 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-700/80 text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />

              <button
                onClick={handleGeneratePairingCode}
                disabled={isGeneratingCode}
                className="px-6 py-2.5 font-extrabold text-sm bg-yellow-400 hover:bg-yellow-300 text-slate-950 rounded-lg transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
              >
                {isGeneratingCode ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
                    Gerando...
                  </>
                ) : (
                  'Gerar Código'
                )}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============================================================== */}
      {/* SEÇÃO DO ROBÔ: EXECUÇÃO AUTOMÁTICA DOS LOTES NO GRUPO          */}
      {/* ============================================================== */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                Robô de Adição Automática Multi-Chip (Anti-Ban)
              </CardTitle>
              <CardDescription>
                O robô reveza entre os {connectedCount > 0 ? connectedCount : '6'} WhatsApps conectados para adicionar os contatos no grupo com intervalo de segurança de 20s.
              </CardDescription>
            </div>

            <Badge tone={connectedCount > 0 ? 'success' : 'neutral'} className="gap-1.5 shrink-0">
              <span className={`h-2 w-2 rounded-full ${connectedCount > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {connectedCount} WhatsApp(s) Conectado(s)
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ALERTA DE NÚMEROS REPETIDOS SE HOUVER */}
          {duplicateCount > 0 && (
            <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 text-amber-950 dark:text-amber-200 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Aviso:</strong> {duplicateCount} contato(s) repetido(s) detectados. O robô irá ignorar duplicados automaticamente para não adicionar ninguém duas vezes.
                </span>
              </div>
              {onRemoveDuplicates && (
                <Button size="sm" variant="outline" onClick={onRemoveDuplicates} className="h-7 text-xs font-bold shrink-0">
                  Limpar Duplicados Agora
                </Button>
              )}
            </div>
          )}

          {/* PARÂMETROS E BOTÃO DE EXECUÇÃO */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-muted/40 rounded-xl border">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Grupo de Destino
              </label>
              <div className="text-sm font-bold truncate text-foreground" title={destinationName || destinationUrl}>
                {destinationName || 'Grupo de Destino'}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground truncate" title={destinationUrl}>
                {destinationUrl || 'Informe o link de destino acima'}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Contatos Prontos
              </label>
              <div className="text-sm font-bold text-foreground">
                {contacts.length - duplicateCount} contatos únicos
              </div>
              <div className="text-[11px] text-emerald-600 font-medium">
                100% filtrados e protegidos
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Meta Anti-Ban por Número
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  disabled={activeTask?.isRunning}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border bg-background text-foreground"
                >
                  <option value={10}>10 contatos / dia</option>
                  <option value={15}>15 contatos / dia</option>
                  <option value={20}>20 contatos / dia (Ideal)</option>
                  <option value={25}>25 contatos / dia</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Intervalo Anti-Ban (Delay)
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                  disabled={activeTask?.isRunning}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border bg-background text-foreground"
                >
                  <option value={15}>15s (Rápido)</option>
                  <option value={20}>20s (Recomendado)</option>
                  <option value={30}>30s (Ultra-Seguro)</option>
                </select>
                <span className="text-[11px] text-muted-foreground">por contato</span>
              </div>
            </div>
          </div>

          {/* PAINEL DE CONTROLE DE TAREFA ATIVA */}
          {activeTask?.isRunning ? (
            <div className="p-5 rounded-2xl bg-card border-2 border-primary/40 space-y-4 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {activeTask.isPaused ? 'Tarefa Pausada' : 'Robô Adicionando Contatos em Tempo Real'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {activeTask.isPaused ? (
                    <Button size="sm" onClick={handleResumeTask} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-8">
                      <Play className="h-3.5 w-3.5" /> Retomar
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={handlePauseTask} className="gap-1.5 font-bold h-8">
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={handleStopTask} className="gap-1.5 font-bold h-8">
                    <Square className="h-3.5 w-3.5" /> Parar
                  </Button>
                </div>
              </div>

              {/* BARRA DE PROGRESSO */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Progresso da Lista</span>
                  <span>
                    {activeTask.currentIndex} de {activeTask.totalContacts} ({Math.round((activeTask.currentIndex / Math.max(1, activeTask.totalContacts)) * 100)}%)
                  </span>
                </div>
                <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                    style={{ width: `${Math.round((activeTask.currentIndex / Math.max(1, activeTask.totalContacts)) * 100)}%` }}
                  />
                </div>
              </div>

              {/* STATUS ATUAL DO REVEZAMENTO */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="p-2.5 bg-muted/40 rounded-xl border">
                  <div className="text-muted-foreground uppercase text-[10px] font-bold">Número Ativo</div>
                  <div className="font-bold text-primary mt-0.5 truncate">{activeTask.currentChip || '-'}</div>
                </div>
                <div className="p-2.5 bg-muted/40 rounded-xl border">
                  <div className="text-muted-foreground uppercase text-[10px] font-bold">Contato Atual</div>
                  <div className="font-bold text-foreground mt-0.5 truncate">{activeTask.currentContact || '-'}</div>
                </div>
                <div className="p-2.5 bg-muted/40 rounded-xl border">
                  <div className="text-muted-foreground uppercase text-[10px] font-bold">Sucessos</div>
                  <div className="font-bold text-emerald-600 mt-0.5">{activeTask.successCount} adicionados</div>
                </div>
                <div className="p-2.5 bg-muted/40 rounded-xl border">
                  <div className="text-muted-foreground uppercase text-[10px] font-bold">Anti-Ban Timer</div>
                  <div className="font-bold text-amber-500 mt-0.5">
                    {activeTask.nextAdditionInSeconds > 0 ? `${activeTask.nextAdditionInSeconds}s restante` : 'Adicionando...'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-2">
              <Button
                onClick={handleStartAdding}
                disabled={isStartingTask || connectedCount === 0 || contacts.length === 0}
                className="w-full py-6 text-base font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg gap-2"
              >
                {isStartingTask ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Iniciando Robô...
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 fill-white" />
                    Iniciar Adição Automática dos Lotes ({connectedCount} WhatsApps Revezando)
                  </>
                )}
              </Button>
              {connectedCount === 0 && (
                <p className="text-xs text-center text-amber-500 mt-2 font-medium">
                  ⚠️ Conecte pelo menos 1 WhatsApp no robô acima para habilitar a adição automática.
                </p>
              )}
            </div>
          )}

          {/* LOGS EM TEMPO REAL */}
          {logs.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Histórico de Ações do Robô em Tempo Real</span>
                <button
                  onClick={() => fetch('/api/robot/clear-logs', { method: 'POST' }).then(fetchStatus)}
                  className="hover:underline text-[11px]"
                >
                  Limpar Logs
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-500 select-none shrink-0">[{log.time}]</span>
                    <span
                      className={
                        log.type === 'success'
                          ? 'text-emerald-400 font-semibold'
                          : log.type === 'warning'
                          ? 'text-amber-400'
                          : log.type === 'error'
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
