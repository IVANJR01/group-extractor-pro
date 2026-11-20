import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Sparkles,
  UsersRound,
  Download,
  Copy,
  ExternalLink,
  Check,
  Search,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Send,
  Zap,
  Trash2,
  UserX,
  Upload,
  FileSpreadsheet,
  ClipboardPaste,
  Filter,
  Calendar,
  Smartphone,
  QrCode,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/contexts/toast';
import { cn } from '@/lib/utils';
import {
  getActiveSession,
  saveActiveSession,
  updateDestinationGroup,
  markContactInvited,
  deleteContacts,
  deleteAdmins,
  deleteSingleContact,
  removeDuplicateContacts,
  generateMultiAdminSchedule,
  toggleBatchCompleted,
  downloadVCardFile,
  downloadGoogleContactsCSV,
  openGoogleContactsImport,
  type ExtractedGroupSession,
  type SavedContact,
} from '@/services/localExtractorStorage';
import { WhatsAppMultiChipRobot } from '@/components/robot/WhatsAppMultiChipRobot';
import { normalizeBrazilianPhoneDigits } from '@/utils/phone';

type RoleFilterType = 'all' | 'members' | 'admins';
type PageLimitType = 50 | 100 | 250 | 500 | 10000;
type InputTabType = 'auto' | 'file' | 'paste';
type ExecutionModeType = 'robot_auto' | 'multi_admin' | 'direct_invite';

export function DashboardPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const targetDestinationUrl = 'https://chat.whatsapp.com/Czqp9FJaYnc85U2eXnuKJN';
  const targetDestinationName = 'Grupo VIP de Destino';

  const [session, setSession] = useState<ExtractedGroupSession | null>(() => getActiveSession());

  const initialDestUrl =
    session?.destinationGroup?.inviteUrl && !session.destinationGroup.inviteUrl.includes('IN7eIb7YPLcJLCPg7AXKr9')
      ? session.destinationGroup.inviteUrl
      : targetDestinationUrl;

  const initialDestName =
    session?.destinationGroup?.name && session.destinationGroup.name !== 'MundoReview | Ofertas #3'
      ? session.destinationGroup.name
      : targetDestinationName;

  const [destinationUrl, setDestinationUrl] = useState(initialDestUrl);
  const [destinationName, setDestinationName] = useState(initialDestName);

  const [inputTab, setInputTab] = useState<InputTabType>('auto');
  const [executionMode, setExecutionMode] = useState<ExecutionModeType>('robot_auto');
  const [pasteInput, setPasteInput] = useState('');
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Configurações do Multi-Admin (6 Contas WhatsApp Admin, 20 contatos/dia cada)
  const [accountsCount, setAccountsCount] = useState<number>(6);
  const [dailyLimitPerAccount, setDailyLimitPerAccount] = useState<number>(20);
  const [activeDayFilter, setActiveDayFilter] = useState<number | 'all'>('all');
  const [showConnectionGuide, setShowConnectionGuide] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilterType>('all');
  const [selectedDigits, setSelectedDigits] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<PageLimitType>(100);
  const [copiedPhones, setCopiedPhones] = useState(false);

  // Sincroniza destino padrão caso esteja vazio ou com valor antigo
  useEffect(() => {
    if (session && (!session.destinationGroup?.inviteUrl || session.destinationGroup.inviteUrl.includes('IN7eIb7YPLcJLCPg7AXKr9'))) {
      const updated = updateDestinationGroup(targetDestinationName, targetDestinationUrl);
      if (updated) {
        setSession(updated);
        setDestinationUrl(targetDestinationUrl);
        setDestinationName(targetDestinationName);
      }
    }
  }, []);

  const lastReceivedAtRef = useRef<number>(0);

  // Polling automático da rota do WhatsApp Web (/api/extracted-contacts)
  useEffect(() => {
    async function checkIncoming() {
      try {
        const res = await fetch('/api/extracted-contacts?consume=true');
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) return;
          const data = await res.json();
          if (data && data.contacts && data.contacts.length > 0) {
            const receivedAt = data._receivedAt || Date.now();
            if (receivedAt > lastReceivedAtRef.current) {
              lastReceivedAtRef.current = receivedAt;
              const validContacts = data.contacts
                .map((c: { name: string; formatted: string; digits: string; isAdmin: boolean }) => {
                  const norm = normalizeBrazilianPhoneDigits(c.digits || c.formatted);
                  return {
                    name: c.name || '',
                    phone: norm.valid ? norm.formatted : (c.formatted || c.digits),
                    digits: norm.valid ? norm.digits : c.digits,
                    isAdmin: Boolean(c.isAdmin),
                    invited: false,
                  };
                })
                .filter((c: any) => c.digits && c.digits.length >= 10 && c.digits.length <= 13);

              const newSession: ExtractedGroupSession = {
                groupName: data.groupName || 'Grupo WhatsApp',
                totalContacts: validContacts.length,
                contacts: validContacts,
                destinationGroup: {
                  name: destinationName || targetDestinationName,
                  inviteUrl: destinationUrl || targetDestinationUrl,
                },
                lastUpdated: new Date().toISOString(),
              };
              saveActiveSession(newSession);
              setSession(newSession);
              toast(`✅ ${newSession.totalContacts} contatos recebidos do WhatsApp Web com sucesso!`, 'info');
            }
          }
        }
      } catch {}
    }

    checkIncoming();
    const interval = setInterval(checkIncoming, 2500);
    return () => clearInterval(interval);
  }, [destinationName, destinationUrl]);

  // UPLOAD DE ARQUIVO EXCEL (.XLSX/.XLS) OU CSV
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    try {
      const fileName = file.name.toLowerCase();
      const newContacts: SavedContact[] = [];

      if (fileName.endsWith('.csv')) {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (i === 0 && (line.toLowerCase().includes('telefone') || line.toLowerCase().includes('phone') || line.toLowerCase().includes('nome'))) {
            continue;
          }
          const parts = line.split(/[;,]/).map((p) => p.replace(/^["']|["']$/g, '').trim());
          let name = '';
          let phone = '';
          let isAdmin = false;

            for (const part of parts) {
              const norm = normalizeBrazilianPhoneDigits(part);
              if (norm.valid && !norm.isLid && !phone) {
                phone = norm.digits;
              } else if (/^(admin|sim|true)$/i.test(part)) {
                isAdmin = true;
              } else if (/^(não|nao|membro|false)$/i.test(part)) {
                // Ignora status de membro ou booleano para não virar nome
              } else if (!name && isNaN(Number(part)) && part.length > 1 && !/^(sim|não|nao|true|false|admin|membro|origem|destino|grupo|vip|whatsapp|sem nome)$/i.test(part) && !part.toLowerCase().includes('promo') && !part.toLowerCase().includes('review') && !part.toLowerCase().includes('grupo')) {
                name = part;
              }
            }

          if (phone) {
            newContacts.push({
              name,
              phone: formatPhoneDisplay(phone),
              digits: phone,
              isAdmin,
              invited: false,
            });
          }
        }
      } else {
        const XLSX = await import('@e965/xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number)[][];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          if (i === 0) {
            const headerStr = row.join(' ').toLowerCase();
            if (headerStr.includes('telefone') || headerStr.includes('phone') || headerStr.includes('nome')) continue;
          }

          let name = '';
          let phone = '';
          let isAdmin = false;

          for (const cell of row) {
            const str = String(cell || '').trim();
            const norm = normalizeBrazilianPhoneDigits(str);
            if (norm.valid && !norm.isLid && !phone) {
              phone = norm.digits;
            } else if (/^(admin|sim|true)$/i.test(str)) {
              isAdmin = true;
            } else if (/^(não|nao|false|membro)$/i.test(str)) {
              isAdmin = false;
            } else if (!name && isNaN(Number(str)) && str.length > 1 && !/^(sim|não|nao|true|false|admin|membro|origem|destino|grupo|vip|whatsapp|sem nome)$/i.test(str) && !str.toLowerCase().includes('promo') && !str.toLowerCase().includes('review') && !str.toLowerCase().includes('grupo')) {
              name = str;
            }
          }

          if (phone) {
            newContacts.push({
              name,
              phone: formatPhoneDisplay(phone),
              digits: phone,
              isAdmin,
              invited: false,
            });
          }
        }
      }

      if (newContacts.length === 0) {
        toast('Nenhum número de telefone válido encontrado no arquivo.', 'error');
        return;
      }

      const map = new Map<string, SavedContact>();
      for (const c of newContacts) {
        if (!map.has(c.digits)) map.set(c.digits, c);
      }
      const deduped = Array.from(map.values());

      const groupLabel = file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ');
      const newSession: ExtractedGroupSession = {
        groupName: groupLabel || 'Planilha Importada',
        totalContacts: deduped.length,
        contacts: deduped,
        destinationGroup: {
          name: destinationName || targetDestinationName,
          inviteUrl: destinationUrl || targetDestinationUrl,
        },
        lastUpdated: new Date().toISOString(),
      };

      saveActiveSession(newSession);
      setSession(newSession);
      setSelectedDigits(new Set());
      lastReceivedAtRef.current = Date.now();
      fetch('/api/extracted-contacts', { method: 'DELETE' }).catch(() => {});
      toast(`✅ ${deduped.length} contatos importados do arquivo com sucesso!`, 'info');
    } catch (err: unknown) {
      console.error(err);
      toast('Erro ao processar o arquivo. Verifique se o formato é válido.', 'error');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // IMPORTAR POR TEXTO COLADO
  const handleImportPastedText = () => {
    if (!pasteInput.trim()) {
      toast('Cole a lista de contatos ou números no campo de texto.', 'error');
      return;
    }

    const lines = pasteInput.split(/\r?\n/);
    const parsed: SavedContact[] = [];
    const seen = new Set<string>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const parts = line.split(/[;,|\t]/);
      let name = '';
      let phone = '';

      for (const p of parts) {
        const norm = normalizeBrazilianPhoneDigits(p);
        if (norm.valid && !norm.isLid && !phone) {
          phone = norm.digits;
        } else if (!name && isNaN(Number(p)) && p.length > 1) {
          name = p.trim();
        }
      }

      if (!phone) {
        const match = line.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4,5}[-\s]?\d{4}/);
        if (match) {
          const norm = normalizeBrazilianPhoneDigits(match[0]);
          if (norm.valid && !norm.isLid) phone = norm.digits;
        }
      }

      if (phone && !seen.has(phone)) {
        seen.add(phone);
        parsed.push({
          name,
          phone: formatPhoneDisplay(phone),
          digits: phone,
          isAdmin: false,
          invited: false,
        });
      }
    }

    if (parsed.length === 0) {
      toast('Nenhum número de telefone válido reconhecido no texto informado.', 'error');
      return;
    }

    const newSession: ExtractedGroupSession = {
      groupName: session?.groupName || 'Lista Colada',
      totalContacts: parsed.length,
      contacts: parsed,
      destinationGroup: {
        name: destinationName || targetDestinationName,
        inviteUrl: destinationUrl || targetDestinationUrl,
      },
      lastUpdated: new Date().toISOString(),
    };

    saveActiveSession(newSession);
    setSession(newSession);
    setPasteInput('');
    lastReceivedAtRef.current = Date.now();
    fetch('/api/extracted-contacts', { method: 'DELETE' }).catch(() => {});
    toast(`✅ ${parsed.length} contatos carregados da lista colada!`, 'info');
  };

  function formatPhoneDisplay(digits: string) {
    if (!digits) return '';
    const norm = normalizeBrazilianPhoneDigits(digits);
    return norm.formatted || (digits.startsWith('55') ? `+${digits}` : `+55${digits}`);
  }

  // SALVAR DESTINO
  const handleSaveDestination = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationUrl.trim()) {
      toast('Por favor, informe o link do grupo de destino.', 'error');
      return;
    }
    const updated = updateDestinationGroup(
      destinationName.trim() || targetDestinationName,
      destinationUrl.trim()
    );
    if (updated) {
      setSession({ ...updated });
      toast('Grupo de destino salvo com sucesso!', 'info');
    }
  };

  const handleCopyAllPhones = () => {
    if (!session || session.contacts.length === 0) return;
    const list = session.contacts.map((c) => c.phone || c.digits).join('\n');
    navigator.clipboard.writeText(list).then(() => {
      setCopiedPhones(true);
      toast(`${session.contacts.length} telefones copiados para a área de transferência!`, 'info');
      setTimeout(() => setCopiedPhones(false), 2500);
    });
  };

  const downloadCSV = () => {
    if (!session || session.contacts.length === 0) return;
    const rows = [['Nome', 'Telefone', 'Digitos', 'Administrador', 'Origem', 'Grupo_Destino']];
    for (const c of session.contacts) {
      rows.push([
        c.name || '',
        c.phone,
        c.digits,
        c.isAdmin ? 'Sim' : 'Não',
        session.groupName,
        destinationName || destinationUrl || '',
      ]);
    }
    const csvContent = '\uFEFF' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos_${(session.groupName || 'whatsapp').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Planilha CSV baixada!', 'info');
  };

  const downloadExcel = async () => {
    if (!session || session.contacts.length === 0) return;
    const XLSX = await import('@e965/xlsx');
    const headers = ['Nome', 'Telefone', 'Digitos', 'Administrador', 'Origem', 'Grupo_Destino'];
    const rows = session.contacts.map((c) => [
      c.name || '',
      c.phone,
      c.digits,
      c.isAdmin ? 'Sim' : 'Não',
      session.groupName,
      destinationName || destinationUrl || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos_${(session.groupName || 'whatsapp').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Planilha Excel (.xlsx) baixada!', 'info');
  };

  // SINCRONIZAR COM GOOGLE CONTATOS (3msolucoes01@gmail.com)
  const [googleEmail, setGoogleEmail] = useState('3msolucoes01@gmail.com');
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [lastDownloadedFile, setLastDownloadedFile] = useState('');
  const [exportFormat, setExportFormat] = useState<'with_55' | 'without_55'>('with_55');

  const handleSyncGoogleContacts = () => {
    if (!session || session.contacts.length === 0) {
      toast('Carregue ou extraia contatos antes de sincronizar.', 'error');
      return;
    }
    const includePlus55 = exportFormat === 'with_55';
    const suffix = includePlus55 ? 'com_55' : 'sem_55';
    const cleanGroupName = (session.groupName || '3mpro').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const fileName = `contatos_${cleanGroupName}_${suffix}_google.csv`;
    setLastDownloadedFile(fileName);

    // 1. Gera e baixa o arquivo CSV formatado especialmente para o Google Contacts
    downloadGoogleContactsCSV(session.groupName || '3mpro', session.contacts, '3MPRO', includePlus55);
    // 2. Abre a página oficial do Google Contacts na conta informada (sem 404)
    openGoogleContactsImport(googleEmail);
    // 3. Abre o modal explicativo com o passo a passo
    setSyncModalOpen(true);
    toast(`📥 Arquivo ${includePlus55 ? 'COM +55' : 'SEM +55'} baixado! No Google Contatos, clique em "Importar contatos" e selecione o arquivo.`, 'info');
  };

  const handleDownloadVCFDirect = () => {
    if (!session || session.contacts.length === 0) {
      toast('Carregue ou extraia contatos antes de baixar o arquivo VCF.', 'error');
      return;
    }
    const includePlus55 = exportFormat === 'with_55';
    downloadVCardFile(session.groupName || 'contatos_agenda_3mpro', session.contacts, includePlus55);
    toast(`📱 Arquivo .VCF ${includePlus55 ? 'COM +55' : 'SEM +55'} baixado! Envie para o WhatsApp do seu celular ou toque nele para salvar na agenda.`, 'info');
  };

  const handleSendSingleInvite = (c: { digits: string; name: string }) => {
    markContactInvited(c.digits, true);
    setSession(getActiveSession());
    const encodedText = encodeURIComponent(
      `Olá ${c.name ? c.name + '! ' : ''}Estamos organizando nosso novo grupo oficial no WhatsApp. Entre aqui: ${destinationUrl || targetDestinationUrl}`
    );
    window.open(`https://wa.me/${c.digits}?text=${encodedText}`, '_blank');
  };

  // EXCLUSÃO EM MASSA
  const handleDeleteAdmins = () => {
    const adminCount = (session?.contacts || []).filter((c) => c.isAdmin).length;
    if (adminCount === 0) {
      toast('Não há administradores na lista.', 'info');
      return;
    }
    const updated = deleteAdmins();
    if (updated) {
      setSession({ ...updated });
      setSelectedDigits(new Set());
      toast(`🛡️ ${adminCount} administrador(es) excluído(s) com sucesso!`, 'info');
    }
  };

  const handleDeleteDuplicates = () => {
    const { removedCount, session: updated } = removeDuplicateContacts();
    if (removedCount > 0 && updated) {
      setSession({ ...updated });
      setSelectedDigits(new Set());
      toast(`🛡️ ${removedCount} número(s) repetido(s) removido(s) com sucesso!`, 'info');
    } else {
      toast('Nenhum número repetido encontrado na lista.', 'info');
    }
  };

  const handleDeleteSelected = () => {
    if (selectedDigits.size === 0) return;
    const count = selectedDigits.size;
    const updated = deleteContacts(Array.from(selectedDigits));
    if (updated) {
      setSession({ ...updated });
      setSelectedDigits(new Set());
      toast(`🗑️ ${count} contato(s) excluído(s) com sucesso!`, 'info');
    }
  };

  const handleDeleteSingle = (digits: string, name: string) => {
    const updated = deleteSingleContact(digits);
    if (updated) {
      setSession({ ...updated });
      const next = new Set(selectedDigits);
      next.delete(digits);
      setSelectedDigits(next);
      toast(`Contato ${name || digits} removido.`, 'info');
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Tem certeza que deseja limpar todos os contatos desta lista?')) {
      const empty: ExtractedGroupSession = {
        groupName: 'Nenhum grupo ativo',
        totalContacts: 0,
        contacts: [],
        destinationGroup: {
          name: destinationName || targetDestinationName,
          inviteUrl: destinationUrl || targetDestinationUrl,
        },
        lastUpdated: new Date().toISOString(),
      };
      saveActiveSession(empty);
      setSession(empty);
      setSelectedDigits(new Set());
      toast('Lista limpa com sucesso.', 'info');
    }
  };

  // MULTI-ADMIN: GERAR CRONOGRAMA COM 6 NÚMEROS E 20 POR NÚMERO
  const handleGenerateSchedule = () => {
    const updated = generateMultiAdminSchedule(accountsCount, dailyLimitPerAccount);
    if (updated) {
      setSession({ ...updated });
      toast(`🚀 Cronograma gerado! Lotes divididos entre ${accountsCount} números (média de ${dailyLimitPerAccount}/dia).`, 'info');
    }
  };

  const handleToggleBatch = (batchId: string, currentStatus: boolean) => {
    const updated = toggleBatchCompleted(batchId, !currentStatus);
    if (updated) {
      setSession({ ...updated });
      toast(!currentStatus ? '✅ Lote marcado como concluído!' : 'Lote desmarcado.', 'info');
    }
  };

  const handleCopyBatchPhones = (contacts: SavedContact[]) => {
    const text = contacts.map((c) => c.phone || c.digits).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast(`📋 ${contacts.length} telefones do lote copiados para a área de transferência!`, 'info');
    });
  };

  const handleDownloadBatchVCard = (adminName: string, dayLabel: string, contacts: SavedContact[]) => {
    downloadVCardFile(`${adminName}_${dayLabel}`, contacts);
    toast(`📥 Arquivo de contatos (.vcf) gerado para ${adminName}!`, 'info');
  };

  // SELEÇÃO
  const toggleSelectOne = (digits: string) => {
    const next = new Set(selectedDigits);
    if (next.has(digits)) next.delete(digits);
    else next.add(digits);
    setSelectedDigits(next);
  };

  const toggleSelectAll = (visibleList: { digits: string }[]) => {
    const allSelected = visibleList.every((c) => selectedDigits.has(c.digits));
    const next = new Set(selectedDigits);
    if (allSelected) {
      visibleList.forEach((c) => next.delete(c.digits));
    } else {
      visibleList.forEach((c) => next.add(c.digits));
    }
    setSelectedDigits(next);
  };

  // DETECÇÃO DE DUPLICIDADES EM TEMPO REAL
  const allContacts = session?.contacts || [];
  const digitsSet = new Set<string>();
  let duplicateCount = 0;
  for (const c of allContacts) {
    if (digitsSet.has(c.digits)) duplicateCount++;
    else digitsSet.add(c.digits);
  }

  // FILTROS
  const adminTotal = allContacts.filter((c) => c.isAdmin).length;
  const memberTotal = allContacts.filter((c) => !c.isAdmin).length;

  const filteredContacts = allContacts.filter((c) => {
    if (roleFilter === 'admins' && !c.isAdmin) return false;
    if (roleFilter === 'members' && c.isAdmin) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (c.name && c.name.toLowerCase().includes(q)) || c.phone.includes(q) || c.digits.includes(q);
  });

  const displayLimit = pageSize === 10000 ? filteredContacts.length : pageSize;
  const paginatedContacts = filteredContacts.slice(0, displayLimit);
  const isAllVisibleSelected = paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedDigits.has(c.digits));

  // Estatísticas do Cronograma Multi-Admin
  const schedule = session?.multiAdminSchedule;
  const totalBatches = schedule?.batches.length || 0;
  const completedContacts = schedule?.batches.filter((b) => b.completed).reduce((acc, b) => acc + b.contacts.length, 0) || 0;

  // Lotes filtrados por dia
  const availableDays = Array.from(new Set(schedule?.batches.map((b) => b.dayIndex) || [])).sort((a, b) => a - b);
  const visibleBatches = schedule?.batches.filter((b) => (activeDayFilter === 'all' ? true : b.dayIndex === activeDayFilter)) || [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      <PageHeader
        title="Painel de Extração & Direcionamento de Grupos"
        description="Extraia contatos, remova administradores e repetidos, e divida a lista entre 6 números de WhatsApp para adicionar 20/dia por número com segurança total."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="success" className="gap-1">
              <Zap className="h-3.5 w-3.5" /> Modo Rápido Ativo
            </Badge>
            <Badge tone="info" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Proteção Anti-Ban (6 Admins)
            </Badge>
          </div>
        }
      />

      {/* GUIA VISUAL DOS 3 PASSOS SIMPLES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all ${allContacts.length > 0 ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-primary/10 border-primary/40'}`}>
          <div className="h-8 w-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
            1
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Etapa 1</div>
            <div className="text-sm font-semibold">{allContacts.length > 0 ? `✅ ${allContacts.length} Contatos Obtidos` : 'Obter Contatos (WhatsApp/Arquivo)'}</div>
          </div>
        </div>

        <div className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all ${adminTotal === 0 && duplicateCount === 0 && allContacts.length > 0 ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-muted/40 border-border'}`}>
          <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0">
            2
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Etapa 2</div>
            <div className="text-sm font-semibold">
              {adminTotal > 0 || duplicateCount > 0 ? `⚠️ Limpar Admins e Repetidos` : 'Lista Filtrada & Sem Repetições'}
            </div>
          </div>
        </div>

        <div className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all ${destinationUrl ? 'bg-blue-500/10 border-blue-500/40' : 'bg-muted/40 border-border'}`}>
          <div className="h-8 w-8 rounded-lg bg-blue-500/20 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0">
            3
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Etapa 3</div>
            <div className="text-sm font-semibold">6 Admins Adicionando 20/dia</div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* ETAPA 1: OBTENÇÃO DOS CONTATOS (AUTOMÁTICO / EXCEL / COLAR) */}
      {/* ============================================================== */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4 text-emerald-500" />
                Etapa 1: Obter os contatos do grupo
              </CardTitle>
              <CardDescription>
                Extraia direto pelo WhatsApp Web, faça upload de arquivo (.xlsx/.csv) ou cole a lista de números.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg">
              <button
                onClick={() => setInputTab('auto')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${inputTab === 'auto' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                ⚡ Automático WhatsApp
              </button>
              <button
                onClick={() => setInputTab('file')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${inputTab === 'file' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                📁 Importar Excel/CSV
              </button>
              <button
                onClick={() => setInputTab('paste')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${inputTab === 'paste' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                📋 Colar Contatos
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {inputTab === 'auto' && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-600 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    Extração Direta do WhatsApp Web Ativa
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Ao clicar em <strong>&ldquo;Extrair Grupo&rdquo;</strong> no WhatsApp Web, os contatos caem aqui automaticamente em tempo real!
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to="/extrair-whatsapp" className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'gap-1.5')}>
                  <Sparkles className="h-3.5 w-3.5" /> Como Extrair
                </Link>
                <a
                  href="https://web.whatsapp.com"
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir WhatsApp Web
                </a>
              </div>
            </div>
          )}

          {inputTab === 'file' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
                id="gep-file-input"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 rounded-xl p-6 text-center cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-bold">
                  {isProcessingFile ? 'Lendo e processando arquivo...' : 'Clique para selecionar seu arquivo Excel (.xlsx, .xls) ou CSV'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Reconhece automaticamente colunas de Nome, Telefone e Administradores. Sem limite de contatos.
                </p>
              </div>
            </div>
          )}

          {inputTab === 'paste' && (
            <div className="space-y-3">
              <textarea
                rows={3}
                placeholder="Cole os telefones aqui (um por linha ou separados por vírgula). Ex:&#10;5511999999999&#10;João; 5584999998888"
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-input bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleImportPastedText} className="gap-1.5">
                  <ClipboardPaste className="h-3.5 w-3.5" /> Carregar Telefones
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================== */}
      {/* SINCRONIZAÇÃO DIRETA COM O GOOGLE CONTATOS (3msolucoes01@gmail.com) */}
      {/* ============================================================== */}
      <Card className="border-blue-500/40 bg-gradient-to-r from-blue-950/20 via-indigo-950/20 to-slate-900 shadow-md">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-400 flex items-center justify-center shrink-0 shadow-inner">
                <span className="text-2xl">👤</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Sincronizar no Google Contatos / Agenda do Celular
                  </h4>
                  {isEditingEmail ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="email"
                        value={googleEmail}
                        onChange={(e) => setGoogleEmail(e.target.value)}
                        className="px-2 py-0.5 text-xs bg-slate-900 border border-blue-500 rounded text-blue-200 font-mono"
                        placeholder="email@gmail.com"
                        autoFocus
                      />
                      <button
                        onClick={() => setIsEditingEmail(false)}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-bold px-1.5 py-0.5 rounded bg-blue-500/20"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsEditingEmail(true)}
                      className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-colors cursor-pointer"
                      title="Clique para alterar o e-mail do Google Contatos"
                    >
                      {googleEmail} ✏️
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Baixe a lista oficial formatada e abra o <strong>Google Contatos</strong> na conta <strong>{googleEmail}</strong> para importar com 1 clique. Todos os contatos aparecem instantaneamente na sua agenda do celular e no WhatsApp sem restrições de convite!
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded-lg px-1 py-0.5">
                <span className="text-[11px] text-slate-400 px-1 font-bold">DDI:</span>
                <button
                  type="button"
                  onClick={() => setExportFormat('with_55')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${exportFormat === 'with_55'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                    }`}
                  title="Formato Internacional completo com +55"
                >
                  🇧🇷 COM +55
                </button>
                <button
                  type="button"
                  onClick={() => setExportFormat('without_55')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${exportFormat === 'without_55'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                    }`}
                  title="Formato Nacional sem +55 (DDD + 9 dígitos)"
                >
                  🇧🇷 SEM +55
                </button>
              </div>

              <Button
                size="sm"
                onClick={handleSyncGoogleContacts}
                disabled={allContacts.length === 0}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2 shadow-lg cursor-pointer h-9 px-4"
              >
                <span>📥</span> Sincronizar Google ({exportFormat === 'with_55' ? '+55' : 'Sem 55'})
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadVCFDirect}
                disabled={allContacts.length === 0}
                className="border-slate-700 hover:bg-slate-800 text-slate-200 gap-1.5 font-bold cursor-pointer h-9 px-3"
                title={`Baixar arquivo VCF ${exportFormat === 'with_55' ? 'COM +55' : 'SEM +55'} para celular/emulador`}
              >
                <span>📱</span> Baixar .VCF ({exportFormat === 'with_55' ? '+55' : 'Sem 55'})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MODAL INFORMATIVO: PASSO A PASSO GOOGLE CONTATOS */}
      <Dialog
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        title={`📥 Como Importar no Google Contatos (${googleEmail})`}
        description="O arquivo oficial foi baixado na sua pasta de Downloads. Siga estes passos simples:"
        className="sm:max-w-xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <Button variant="outline" size="sm" onClick={() => setSyncModalOpen(false)}>
              Fechar
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2"
              onClick={() => openGoogleContactsImport(googleEmail)}
            >
              <ExternalLink className="size-4" />
              Abrir Google Contatos
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-3">
            <span className="text-2xl">📁</span>
            <div>
              <p className="font-semibold text-blue-200">
                Arquivo baixado na sua pasta de Downloads:
              </p>
              <code className="text-xs bg-slate-900 px-2 py-0.5 rounded text-blue-300 font-mono">
                {lastDownloadedFile || 'contatos_3mpro_google.csv'}
              </code>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-card/60 border border-border">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
                1
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Acesse a aba do <strong>Google Contatos</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A página da conta <strong>{googleEmail}</strong> foi aberta no seu navegador.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-card/60 border border-border">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
                2
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Clique no botão azul <strong>"Importar contatos"</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ele fica bem no centro da tela (ou no menu lateral esquerdo em <em>"Importar"</em>).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-card/60 border border-border">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
                3
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Selecione o arquivo e clique em <strong>"Importar"</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Escolha o arquivo que acabou de baixar na sua pasta de Downloads. Em 5 segundos todos os contatos estarão salvos no Google e sincronizados no seu celular!
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Baixar novamente:</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => downloadGoogleContactsCSV(session?.groupName || '3mpro', session?.contacts || [], '3MPRO')}
              >
                📥 Baixar CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => downloadVCardFile(session?.groupName || 'contatos_agenda_3mpro', session?.contacts || [])}
              >
                📱 Baixar .VCF
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      {/* SE AINDA NÃO HÁ CONTATOS IMPORTADOS: MOSTRA O ROBÔ PARA JÁ PODER CONECTAR OS CHIPS */}
      {allContacts.length === 0 && (
        <div className="space-y-4">
          <WhatsAppMultiChipRobot
            destinationUrl={destinationUrl}
            destinationName={destinationName}
            contacts={[]}
            onRemoveDuplicates={handleDeleteDuplicates}
            duplicateCount={0}
          />
        </div>
      )}

      {/* ============================================================== */}
      {/* ETAPA 2 & 3: CONTATOS CARREGADOS, LIMPEZA E CRONOGRAMA 6 ADMINS */}
      {/* ============================================================== */}
      {allContacts.length > 0 && (
        <div className="space-y-6">
          {/* RESUMO DOS CONTATOS */}
          <div className="grid md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-card to-emerald-500/5 border-emerald-500/30">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Origem</span>
                  <Badge tone="success">Pronto</Badge>
                </div>
                <h3 className="text-xl font-bold mt-1 truncate" title={session?.groupName}>
                  {session?.groupName || 'Lista Ativa'}
                </h3>
                <p className="text-sm font-semibold text-muted-foreground mt-0.5">
                  {session?.totalContacts} participantes extraídos
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-amber-500/5 border-amber-500/30">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Administradores</span>
                  <Badge tone={adminTotal > 0 ? 'warning' : 'neutral'}>
                    {adminTotal} detectado(s)
                  </Badge>
                </div>
                <h3 className="text-xl font-bold mt-1">
                  {adminTotal} admins
                </h3>
                {adminTotal > 0 ? (
                  <button
                    onClick={handleDeleteAdmins}
                    className="text-xs font-bold text-destructive hover:underline mt-1 flex items-center gap-1"
                  >
                    <UserX className="h-3.5 w-3.5" /> Excluir todos os admins
                  </button>
                ) : (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">Nenhum admin na lista</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-blue-500/5 border-blue-500/30">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Membros Únicos</span>
                  <Badge tone={duplicateCount > 0 ? 'warning' : 'info'}>
                    {duplicateCount > 0 ? `${duplicateCount} repetidos` : 'Sem repetições'}
                  </Badge>
                </div>
                <h3 className="text-xl font-bold mt-1">
                  {memberTotal - duplicateCount} membros únicos
                </h3>
                {duplicateCount > 0 ? (
                  <button
                    onClick={handleDeleteDuplicates}
                    className="text-xs font-bold text-destructive hover:underline mt-1 flex items-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir {duplicateCount} repetidos
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    100% livres de duplicidade
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-purple-500/5 border-purple-500/30">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Adições Seguras</span>
                  <Badge tone="success">{completedContacts} de {memberTotal}</Badge>
                </div>
                <h3 className="text-xl font-bold mt-1">
                  {memberTotal > 0 ? Math.round((completedContacts / memberTotal) * 100) : 0}% adicionados
                </h3>
                <div className="h-2 w-full bg-muted rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all duration-300"
                    style={{ width: `${memberTotal > 0 ? Math.round((completedContacts / memberTotal) * 100) : 0}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ALERTA DE ADMINISTRADORES SE HOUVER */}
          {adminTotal > 0 && (
            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-950 dark:text-amber-200">
                    Aviso: {adminTotal} Administrador(es) do grupo original detectados!
                  </h4>
                  <p className="text-xs text-amber-900/80 dark:text-amber-300/80">
                    Exclua os administradores do grupo antigo com 1 clique para não adicioná-los nem convidar por engano.
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAdmins}
                className="gap-2 shrink-0 font-bold shadow-md bg-destructive hover:bg-destructive/90"
              >
                <UserX className="h-4 w-4" /> Excluir {adminTotal} Administradores Agora
              </Button>
            </div>
          )}

          {/* ALERTA DE NÚMEROS REPETIDOS SE HOUVER */}
          {duplicateCount > 0 && (
            <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-red-500/20 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-red-950 dark:text-red-200">
                    Aviso: {duplicateCount} Número(s) repetido(s) encontrados na lista!
                  </h4>
                  <p className="text-xs text-red-900/80 dark:text-red-300/80">
                    Exclua os números repetidos para não adicionar a mesma pessoa duas vezes no grupo de destino.
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteDuplicates}
                className="gap-2 shrink-0 font-bold shadow-md bg-destructive hover:bg-destructive/90"
              >
                <Trash2 className="h-4 w-4" /> Excluir {duplicateCount} Repetidos Agora
              </Button>
            </div>
          )}

          {/* CONFIGURAÇÃO DO GRUPO DE DESTINO */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UsersRound className="h-5 w-5 text-blue-500" />
                Grupo de Destino (Onde os 6 WhatsApps Admin vão adicionar)
              </CardTitle>
              <CardDescription>
                Link e nome do grupo de destino onde os novos membros serão colocados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveDestination} className="grid md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Nome do Grupo de Destino</label>
                  <input
                    type="text"
                    placeholder="Ex: Grupo VIP de Destino"
                    value={destinationName}
                    onChange={(e) => setDestinationName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="md:col-span-6">
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Link de Convite do Grupo de Destino</label>
                  <input
                    type="url"
                    placeholder="https://chat.whatsapp.com/Czqp9FJaYnc85U2eXnuKJN"
                    value={destinationUrl}
                    onChange={(e) => setDestinationUrl(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button type="submit" className="w-full gap-2">
                    Salvar Destino
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* ============================================================== */}
          {/* SELETOR DE ESTRATÉGIA: ROBÔ AUTOMÁTICO vs CRONOGRAMA vs CONVITE */}
          {/* ============================================================== */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setExecutionMode('robot_auto')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  executionMode === 'robot_auto'
                    ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <Bot className="h-4 w-4" />
                Robô Multi-Chip Automático (Revezando 20/dia)
              </button>
              <button
                onClick={() => setExecutionMode('multi_admin')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  executionMode === 'multi_admin'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                Cronograma Manual & VCard (.vcf)
              </button>
              <button
                onClick={() => setExecutionMode('direct_invite')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  executionMode === 'direct_invite'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <Send className="h-4 w-4" />
                Lista Geral & Convite Individual (wa.me)
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConnectionGuide(!showConnectionGuide)}
              className="gap-1.5 text-xs font-semibold shrink-0"
            >
              <QrCode className="h-3.5 w-3.5" />
              {showConnectionGuide ? 'Ocultar Guia de Conexão' : 'Como Conectar os 6 WhatsApps?'}
            </Button>
          </div>

          {/* GUIA DE CONEXÃO DOS 6 WHATSAPPS (QR CODE OU CÓDIGO) */}
          {showConnectionGuide && (
            <div className="p-5 rounded-2xl border border-blue-500/30 bg-blue-500/5 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-blue-500/20 text-blue-600 flex items-center justify-center font-bold shrink-0">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      Como Conectar e Usar os 6 WhatsApps no mesmo Computador:
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Você pode conectar tanto por <strong>QR Code</strong> quanto por <strong>Código de Emparelhamento por Telefone</strong>.
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setShowConnectionGuide(false)} className="h-7 text-xs">
                  Fechar
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* MÉTODO 1: PERFIS DO NAVEGADOR */}
                <div className="p-3.5 bg-background rounded-xl border border-border space-y-2">
                  <div className="font-bold text-primary flex items-center gap-1.5">
                    <QrCode className="h-4 w-4" /> Opção 1: Via QR Code (Perfis de Navegador)
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground leading-relaxed">
                    <li>No Google Chrome ou Edge, clique no seu ícone de perfil no topo direito e clique em <strong>&ldquo;Adicionar Perfil&rdquo;</strong>.</li>
                    <li>Crie 6 perfis: <em>Perfil A, Perfil B, Perfil C, Perfil D, Perfil E, Perfil F</em>.</li>
                    <li>Em cada perfil, abra <code>web.whatsapp.com</code>.</li>
                    <li>No celular correspondente, abra <strong>WhatsApp &gt; Aparelhos Conectados &gt; Conectar um aparelho</strong> e aponte a câmera para o QR Code da tela.</li>
                  </ol>
                </div>

                {/* MÉTODO 2: CÓDIGO DO DISPOSITIVO */}
                <div className="p-3.5 bg-background rounded-xl border border-border space-y-2">
                  <div className="font-bold text-emerald-600 flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4" /> Opção 2: Via Código do Dispositivo (Sem câmera)
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground leading-relaxed">
                    <li>No WhatsApp Web, clique em <strong>&ldquo;Conectar com número de telefone&rdquo;</strong> (abaixo do QR Code).</li>
                    <li>Digite o número do celular com DDD (ex: <code>55 11 99999-9999</code>).</li>
                    <li>O WhatsApp Web gerará um código de 8 letras/números (ex: <code>ABCD-1234</code>).</li>
                    <li>O celular receberá uma notificação: toque nela e digite o código de 8 dígitos para conectar na hora!</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* MODO 0: ROBÔ MULTI-CHIP AUTOMÁTICO (WHATSAPPS CONECTADOS)       */}
          {/* ============================================================== */}
          {executionMode === 'robot_auto' && (
            <WhatsAppMultiChipRobot
              destinationUrl={destinationUrl}
              destinationName={destinationName}
              contacts={allContacts}
              onRemoveDuplicates={handleDeleteDuplicates}
              duplicateCount={duplicateCount}
            />
          )}

          {/* ============================================================== */}
          {/* MODO 1: ESTRATÉGIA SEGURA MULTI-ADMIN (6 WHATSAPPS ADMIN) */}
          {/* ============================================================== */}
          {executionMode === 'multi_admin' && (
            <div className="space-y-6">
              {/* CARD DE CONTROLE E REGRAS ANTI-BAN */}
              <Card className="border-emerald-500/40 bg-gradient-to-br from-card to-emerald-500/5">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Smartphone className="h-5 w-5 text-emerald-500" />
                        Planejador de Adição Segura: 6 Números Admin
                      </CardTitle>
                      <CardDescription>
                        Distribua os contatos entre os 6 números de WhatsApp. Cada número adiciona em média 20 contatos por dia para evitar banimento.
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2 bg-background border rounded-lg px-3 py-1.5 text-xs">
                        <span className="font-semibold text-muted-foreground">Números:</span>
                        <select
                          value={accountsCount}
                          onChange={(e) => setAccountsCount(Number(e.target.value))}
                          className="bg-transparent font-bold text-primary focus:outline-none cursor-pointer"
                        >
                          <option value={5}>5 Números</option>
                          <option value={6}>6 Números (Recomendado)</option>
                          <option value={8}>8 Números</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2 bg-background border rounded-lg px-3 py-1.5 text-xs">
                        <span className="font-semibold text-muted-foreground">Meta diária:</span>
                        <select
                          value={dailyLimitPerAccount}
                          onChange={(e) => setDailyLimitPerAccount(Number(e.target.value))}
                          className="bg-transparent font-bold text-primary focus:outline-none cursor-pointer"
                        >
                          <option value={10}>10 contatos / dia</option>
                          <option value={15}>15 contatos / dia</option>
                          <option value={20}>20 contatos / dia (Ideal)</option>
                          <option value={25}>25 contatos / dia</option>
                        </select>
                      </div>

                      <Button onClick={handleGenerateSchedule} className="gap-2 font-bold shadow-sm">
                        <Calendar className="h-4 w-4" />
                        {schedule ? 'Recalcular Lotes' : 'Gerar Cronograma'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* RESUMO DE VELOCIDADE ANTI-BAN */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3 bg-background rounded-xl border">
                      <div className="text-xl font-bold text-primary">{accountsCount} Números</div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase">Admins Ativos</div>
                    </div>
                    <div className="p-3 bg-background rounded-xl border">
                      <div className="text-xl font-bold text-emerald-600">
                        {accountsCount * dailyLimitPerAccount} contatos/dia
                      </div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase">Capacidade Diária Total</div>
                    </div>
                    <div className="p-3 bg-background rounded-xl border">
                      <div className="text-xl font-bold text-blue-600">
                        ~{accountsCount * dailyLimitPerAccount * 7} contatos
                      </div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase">Por Semana (7 dias)</div>
                    </div>
                    <div className="p-3 bg-background rounded-xl border">
                      <div className="text-xl font-bold text-purple-600">
                        {Math.ceil(memberTotal / (accountsCount * dailyLimitPerAccount))} dias
                      </div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase">Tempo Total Estimado</div>
                    </div>
                  </div>

                  {/* DICA DE OURO DO VCARD */}
                  <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-950 dark:text-amber-200 flex items-start gap-3">
                    <div className="h-6 w-6 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
                      💡
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold">Como adicionar no WhatsApp sem risco de erro ou banimento:</p>
                      <p className="text-amber-900/80 dark:text-amber-300/80 leading-relaxed">
                        Em cada lote de 20 contatos, clique em <strong>&ldquo;Baixar VCard (.vcf)&rdquo;</strong> e importe o arquivo na agenda do celular do número correspondente (Número A, B, etc.). Os 20 contatos ficam salvos na agenda em segundos. Depois, no WhatsApp desse número, basta abrir o grupo de destino, tocar em <em>&ldquo;Adicionar participantes&rdquo;</em> e selecionar os 20 contatos! O WhatsApp adiciona direto sem erro.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* CRONOGRAMA DE DIAS E LOTES */}
              {!schedule ? (
                <div className="text-center py-12 border-2 border-dashed rounded-xl p-8 bg-muted/20">
                  <Smartphone className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
                  <h3 className="text-base font-bold">Nenhum cronograma gerado ainda</h3>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                    Clique no botão <strong>&ldquo;Gerar Cronograma&rdquo;</strong> acima para distribuir automaticamente os {memberTotal} contatos entre os 6 números admin (20 contatos por número por dia, sem repetições).
                  </p>
                  <Button onClick={handleGenerateSchedule} className="gap-2">
                    <Calendar className="h-4 w-4" /> Gerar Cronograma dos 6 Números
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* FILTRO DE DIAS (TABS) */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                    <button
                      onClick={() => setActiveDayFilter('all')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg shrink-0 transition-all ${
                        activeDayFilter === 'all'
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Todos os Dias ({totalBatches} Lotes)
                    </button>
                    {availableDays.map((d) => {
                      const dayBatches = schedule.batches.filter((b) => b.dayIndex === d);
                      const dayDone = dayBatches.every((b) => b.completed);
                      return (
                        <button
                          key={d}
                          onClick={() => setActiveDayFilter(d)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg shrink-0 flex items-center gap-1.5 transition-all ${
                            activeDayFilter === d
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : dayDone
                              ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          Dia {d} {dayDone && '✓'}
                        </button>
                      );
                    })}
                  </div>

                  {/* LISTA DOS LOTES POR ADMIN */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visibleBatches.map((b) => (
                      <Card
                        key={b.id}
                        className={`transition-all border ${
                          b.completed
                            ? 'bg-emerald-500/5 border-emerald-500/40 opacity-80'
                            : 'bg-card border-border hover:border-primary/50'
                        }`}
                      >
                        <CardHeader className="p-4 pb-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-muted-foreground uppercase">
                              {b.dayLabel}
                            </span>
                            <Badge tone={b.completed ? 'success' : 'neutral'}>
                              {b.completed ? '✓ Adicionado' : 'Pendente'}
                            </Badge>
                          </div>
                          <CardTitle className="text-sm font-bold flex items-center gap-1.5 mt-1">
                            <Smartphone className="h-4 w-4 text-emerald-600" />
                            {b.adminName}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Lote com <strong>{b.contacts.length} contatos únicos</strong> (sem repetição)
                          </CardDescription>
                        </CardHeader>

                        <CardContent className="p-4 pt-2 space-y-3">
                          {/* PRÉVIA DOS CONTATOS */}
                          <div className="text-[11px] font-mono bg-muted/50 p-2 rounded-lg max-h-24 overflow-y-auto space-y-0.5 border border-border/50">
                            {b.contacts.slice(0, 4).map((c, idx) => (
                              <div key={idx} className="truncate text-muted-foreground">
                                • {c.name || 'Sem nome'}: {c.phone}
                              </div>
                            ))}
                            {b.contacts.length > 4 && (
                              <div className="text-primary font-bold text-[10px] pt-1">
                                + {b.contacts.length - 4} contatos neste lote
                              </div>
                            )}
                          </div>

                          {/* BOTÕES DE AÇÃO DO LOTE */}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadBatchVCard(b.adminName, b.dayLabel, b.contacts)}
                              className="h-8 text-[11px] gap-1 font-semibold"
                              title="Baixar arquivo VCF para salvar na agenda do celular desse número"
                            >
                              <Download className="h-3 w-3" /> VCard (.vcf)
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopyBatchPhones(b.contacts)}
                              className="h-8 text-[11px] gap-1 font-semibold"
                              title="Copiar lista de números para colar na busca do WhatsApp"
                            >
                              <Copy className="h-3 w-3" /> Copiar Lista
                            </Button>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t">
                            <a
                              href="https://web.whatsapp.com"
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                              WhatsApp Web <ExternalLink className="h-3 w-3" />
                            </a>

                            <Button
                              size="sm"
                              variant={b.completed ? 'secondary' : 'default'}
                              onClick={() => handleToggleBatch(b.id, b.completed)}
                              className={`h-7 text-xs font-bold gap-1 ${b.completed ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {b.completed ? 'Adicionado' : 'Marcar Feito'}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* MODO 2: LISTA GERAL E CONVITE INDIVIDUAL (wa.me) */}
          {/* ============================================================== */}
          {executionMode === 'direct_invite' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-emerald-500" />
                      Lista de Contatos Prontos ({filteredContacts.length} de {session?.totalContacts})
                    </CardTitle>
                    <CardDescription>
                      Selecione contatos pelas caixinhas para excluir em massa, ou envie o convite individual com 1 clique.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {adminTotal > 0 && (
                      <Button variant="destructive" size="sm" onClick={handleDeleteAdmins} className="gap-1.5 font-bold">
                        <UserX className="h-3.5 w-3.5" /> Excluir {adminTotal} Admins
                      </Button>
                    )}
                    {duplicateCount > 0 && (
                      <Button variant="destructive" size="sm" onClick={handleDeleteDuplicates} className="gap-1.5 font-bold">
                        <Trash2 className="h-3.5 w-3.5" /> Excluir {duplicateCount} Repetidos
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={handleCopyAllPhones} className="gap-1.5">
                      {copiedPhones ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedPhones ? 'Copiados!' : 'Copiar Telefones'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadCSV} className="gap-1.5">
                      <Download className="h-3.5 w-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadExcel} className="gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClearAll} className="gap-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" /> Limpar Lista
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* FILTROS E BUSCA */}
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    <button
                      onClick={() => setRoleFilter('all')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                        roleFilter === 'all'
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Todos ({allContacts.length})
                    </button>
                    <button
                      onClick={() => setRoleFilter('members')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                        roleFilter === 'members'
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Membros Comuns ({memberTotal})
                    </button>
                    <button
                      onClick={() => setRoleFilter('admins')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                        roleFilter === 'admins'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Admins ({adminTotal})
                    </button>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative w-full sm:w-64">
                      <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar por nome ou número..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-input bg-background"
                      />
                    </div>

                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Filter className="h-3.5 w-3.5" />
                      <span>Ver:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value) as PageLimitType)}
                        className="text-xs bg-background border border-input rounded px-1.5 py-1"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={500}>500</option>
                        <option value={10000}>Todos ({filteredContacts.length})</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* BARRA DE AÇÃO EM MASSA */}
                {selectedDigits.size > 0 && (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl flex items-center justify-between animate-in fade-in duration-200">
                    <span className="text-xs font-semibold text-destructive flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      <strong>{selectedDigits.size}</strong> contato(s) selecionado(s)
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleDeleteSelected}
                        className="h-8 text-xs gap-1.5 font-bold shadow-sm"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir Selecionados ({selectedDigits.size})
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedDigits(new Set())}
                        className="h-8 text-xs text-muted-foreground"
                      >
                        Desmarcar Todos
                      </Button>
                    </div>
                  </div>
                )}

                {/* TABELA DE CONTATOS */}
                <div className="border border-border rounded-lg max-h-[460px] overflow-y-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-10 text-center">
                          <input
                            type="checkbox"
                            checked={isAllVisibleSelected}
                            onChange={() => toggleSelectAll(paginatedContacts)}
                            className="rounded border-input text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                            title="Selecionar todos os visíveis"
                          />
                        </TH>
                        <TH className="w-12">#</TH>
                        <TH>Nome / Apelido</TH>
                        <TH>Telefone (com DDD)</TH>
                        <TH>Cargo</TH>
                        <TH className="text-right">Ação Direta</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {paginatedContacts.map((c, i) => {
                        const isSelected = selectedDigits.has(c.digits);
                        return (
                          <TR key={c.digits + i} className={isSelected ? 'bg-destructive/5' : undefined}>
                            <TD className="text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectOne(c.digits)}
                                className="rounded border-input text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                              />
                            </TD>
                            <TD className="text-xs text-muted-foreground">{i + 1}</TD>
                            <TD className="font-medium text-xs">{c.name || 'Sem nome salvo'}</TD>
                            <TD className="font-mono text-xs">{c.phone}</TD>
                            <TD>
                              {c.isAdmin ? (
                                <Badge tone="warning" className="font-bold">Admin</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Membro</span>
                              )}
                            </TD>
                            <TD className="text-right flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant={c.invited ? 'outline' : 'default'}
                                onClick={() => handleSendSingleInvite(c)}
                                disabled={!destinationUrl}
                                className="h-7 text-xs gap-1.5"
                              >
                                <Send className="h-3 w-3" />
                                {c.invited ? 'Reenviar' : 'Chamar no WhatsApp'}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteSingle(c.digits, c.name)}
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Excluir este contato"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>

                {filteredContacts.length > displayLimit && (
                  <p className="text-center text-xs text-muted-foreground pt-1">
                    Exibindo {displayLimit} de {filteredContacts.length} contatos. Altere o seletor <strong>"Ver:"</strong> acima para &ldquo;Todos&rdquo; para ver a lista inteira de uma vez.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
