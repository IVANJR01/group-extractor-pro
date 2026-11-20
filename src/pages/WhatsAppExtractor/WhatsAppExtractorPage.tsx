import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Copy,
  Check,
  ExternalLink,
  FileText,
  Upload,
  Zap,
  ShieldCheck,
  Search,
  Sparkles,
  ArrowRight,
  FolderArchive,
  Terminal,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice, PageHeader } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ValidationBadge } from '@/components/shared/StatusBadge';
import { useToast } from '@/contexts/toast';
import { WHATSAPP_CONSOLE_SCRIPT } from '@/utils/whatsappConsoleScript';
import { generateExtensionZipBlob } from '@/utils/extensionZip';
import {
  parseWhatsAppChatExport,
  parsePastedWhatsAppText,
  type ExtractedWhatsAppContact,
} from '@/utils/whatsappChatParser';
import { saveActiveSession } from '@/services/localExtractorStorage';
import { cn } from '@/lib/utils';

type TabType = 'extension' | 'console' | 'file' | 'paste';

export function WhatsAppExtractorPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentTab, setCurrentTab] = useState<TabType>('extension');
  const [copiedScript, setCopiedScript] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Estados para modo Arquivo (.txt)
  const [fileContacts, setFileContacts] = useState<ExtractedWhatsAppContact[]>([]);
  const [fileGroupName, setFileGroupName] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileFilter, setFileFilter] = useState('');

  // Estados para modo Colagem
  const [pastedText, setPastedText] = useState('');
  const [pastedContacts, setPastedContacts] = useState<ExtractedWhatsAppContact[]>([]);
  const [pastedFilter, setPastedFilter] = useState('');

  // Copiar script do console
  const handleCopyScript = () => {
    navigator.clipboard.writeText(WHATSAPP_CONSOLE_SCRIPT).then(() => {
      setCopiedScript(true);
      toast('Script copiado com sucesso! Agora cole no Console (F12) do WhatsApp Web.', 'info');
      setTimeout(() => setCopiedScript(false), 3000);
    });
  };

  // Baixar extensão compactada em .zip
  const handleDownloadExtension = async () => {
    try {
      setDownloadingZip(true);
      const blob = await generateExtensionZipBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'group-extractor-pro-whatsapp-extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Extensão baixada! Siga os passos abaixo para carregar no navegador.', 'info');
    } catch {
      toast('Erro ao gerar arquivo zip da extensão.', 'error');
    } finally {
      setDownloadingZip(false);
    }
  };

  // Upload de arquivo de log .txt do WhatsApp
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      const result = parseWhatsAppChatExport(content);
      setFileContacts(result.contacts);
      setFileGroupName(result.groupName || file.name.replace(/\.[^/.]+$/, ''));
      toast(`${result.totalUniquePhones} contatos extraídos do arquivo!`, 'info');
    };
    reader.readAsText(file);
  };

  // Processamento de texto colado
  const handlePastedChange = (text: string) => {
    setPastedText(text);
    if (!text.trim()) {
      setPastedContacts([]);
      return;
    }
    const contacts = parsePastedWhatsAppText(text);
    setPastedContacts(contacts);
  };

  // Exportar lista para CSV / Excel
  const exportContactsToCSV = (contacts: ExtractedWhatsAppContact[], groupName: string) => {
    if (contacts.length === 0) {
      toast('Nenhum contato para exportar.', 'error');
      return;
    }
    const rows = [['Nome', 'Telefone', 'Telefone_Formatado', 'Status', 'Admin', 'Origem']];
    for (const c of contacts) {
      rows.push([
        c.name || '',
        c.normalizedPhone || c.rawPhone,
        c.formattedPhone,
        c.status,
        c.isAdmin ? 'Sim' : 'Não',
        groupName || 'WhatsApp Group',
      ]);
    }
    const csvContent = '\uFEFF' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos_${(groupName || 'whatsapp').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Arquivo CSV/Excel baixado com sucesso!', 'info');
  };

  // Enviar contatos diretamente para a tela de Início Rápido
  const handleForwardToImport = (contacts: ExtractedWhatsAppContact[], groupName: string) => {
    if (contacts.length === 0) return;
    saveActiveSession({
      groupName: groupName || 'Grupo WhatsApp',
      totalContacts: contacts.length,
      contacts: contacts.map((c) => ({
        name: c.name || '',
        phone: c.formattedPhone || c.normalizedPhone,
        digits: c.normalizedPhone.replace(/\D/g, ''),
        isAdmin: Boolean(c.isAdmin),
        invited: false,
      })),
      lastUpdated: new Date().toISOString(),
    });
    toast(`✅ ${contacts.length} contatos prontos no Início Rápido!`, 'info');
    navigate('/');
  };

  const filteredFileContacts = fileContacts.filter((c) =>
    (c.name && c.name.toLowerCase().includes(fileFilter.toLowerCase())) ||
    c.normalizedPhone.includes(fileFilter) ||
    c.formattedPhone.includes(fileFilter)
  );

  const filteredPastedContacts = pastedContacts.filter((c) =>
    (c.name && c.name.toLowerCase().includes(pastedFilter.toLowerCase())) ||
    c.normalizedPhone.includes(pastedFilter) ||
    c.formattedPhone.includes(pastedFilter)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Extrator de Grupos do WhatsApp"
        description="Extraia membros e contatos de qualquer grupo do WhatsApp com alta precisão, detecção de nomes, DDDs e exportação para Excel e CSV."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="success" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> 100% Seguro
            </Badge>
            <Badge tone="info" className="gap-1">
              <Zap className="h-3.5 w-3.5" /> Instantâneo
            </Badge>
          </div>
        }
      />

      {/* Navegação por Abas de Método */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-b border-border pb-2">
        <button
          onClick={() => setCurrentTab('extension')}
          className={`flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-lg transition-all ${
            currentTab === 'extension'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/50 hover:bg-muted text-muted-foreground'
          }`}
        >
          <FolderArchive className="h-4 w-4" />
          <span>Extensão Chrome</span>
          <span className="text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded font-bold">TOP</span>
        </button>

        <button
          onClick={() => setCurrentTab('console')}
          className={`flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-lg transition-all ${
            currentTab === 'console'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/50 hover:bg-muted text-muted-foreground'
          }`}
        >
          <Terminal className="h-4 w-4" />
          <span>Script no Console</span>
        </button>

        <button
          onClick={() => setCurrentTab('file')}
          className={`flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-lg transition-all ${
            currentTab === 'file'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/50 hover:bg-muted text-muted-foreground'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Arquivo de Chat (.txt)</span>
        </button>

        <button
          onClick={() => setCurrentTab('paste')}
          className={`flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-lg transition-all ${
            currentTab === 'paste'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/50 hover:bg-muted text-muted-foreground'
          }`}
        >
          <Copy className="h-4 w-4" />
          <span>Colagem Rápida</span>
        </button>
      </div>

      {/* ABA 1: EXTENSÃO DO CHROME */}
      {currentTab === 'extension' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-emerald-500" />
                    Extensão Group Extractor Pro para o WhatsApp Web
                  </CardTitle>
                  <CardDescription>
                    Adiciona um botão inteligente dentro do WhatsApp Web para extrair participantes com 1 clique direto na tela.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleDownloadExtension} disabled={downloadingZip} className="gap-2">
                    <Download className="h-4 w-4" />
                    {downloadingZip ? 'Gerando .zip...' : 'Baixar Extensão (.zip)'}
                  </Button>
                  <a
                    href="https://web.whatsapp.com"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: 'outline' }), 'gap-2')}
                  >
                    <ExternalLink className="h-4 w-4" /> Abrir WhatsApp Web
                  </a>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <Notice>
                A extensão roda 100% no seu navegador, sem envio de credenciais ou dados externos. Funciona no Google Chrome, Microsoft Edge, Brave e Opera.
              </Notice>

              <div className="grid md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-border bg-card/50 space-y-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-sm">
                    1
                  </div>
                  <h4 className="font-semibold text-sm">Baixe e Descompacte</h4>
                  <p className="text-xs text-muted-foreground">
                    Clique no botão acima para baixar o arquivo <code>group-extractor-pro-whatsapp-extension.zip</code> e extraia a pasta no seu computador.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border bg-card/50 space-y-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-sm">
                    2
                  </div>
                  <h4 className="font-semibold text-sm">Ative Modo Desenvolvedor</h4>
                  <p className="text-xs text-muted-foreground">
                    No seu navegador, abra <code>chrome://extensions</code> (ou <code>edge://extensions</code>) e ative a chave <strong>Modo do desenvolvedor</strong>.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border bg-card/50 space-y-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-sm">
                    3
                  </div>
                  <h4 className="font-semibold text-sm">Carregar sem compactação</h4>
                  <p className="text-xs text-muted-foreground">
                    Clique em <strong>Carregar sem compactação</strong> no canto superior esquerdo e selecione a pasta da extensão descompactada.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border bg-card/50 space-y-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-sm">
                    4
                  </div>
                  <h4 className="font-semibold text-sm">Extraia no WhatsApp Web</h4>
                  <p className="text-xs text-muted-foreground">
                    Abra o WhatsApp Web, clique em qualquer grupo e use o botão flutuante <strong>Extrair Grupo</strong> para baixar em Excel ou CSV!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ABA 2: SCRIPT RÁPIDO DO CONSOLE */}
      {currentTab === 'console' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-emerald-500" />
                    Extração Instantânea via Console (Zero Instalação)
                  </CardTitle>
                  <CardDescription>
                    Não precisa instalar nada! Basta colar o script abaixo no Console do desenvolvedor do WhatsApp Web.
                  </CardDescription>
                </div>
                <Button onClick={handleCopyScript} className="gap-2">
                  {copiedScript ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedScript ? 'Copiado!' : 'Copiar Script Completo'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="p-3 bg-muted/40 rounded-lg border border-border text-xs">
                  <strong>Passo 1:</strong> Abra o WhatsApp Web no navegador e entre no grupo desejado.
                </div>
                <div className="p-3 bg-muted/40 rounded-lg border border-border text-xs">
                  <strong>Passo 2:</strong> Pressione a tecla <code>F12</code> (ou <code>Ctrl+Shift+I</code>) e clique na aba <strong>Console</strong>.
                </div>
                <div className="p-3 bg-muted/40 rounded-lg border border-border text-xs">
                  <strong>Passo 3:</strong> Cole o código e aperte <code>Enter</code>. Uma janela abrirá na hora com o botão de exportar!
                </div>
              </div>

              <div className="relative">
                <pre className="p-4 bg-slate-950 text-slate-100 rounded-lg text-xs font-mono max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap">
                  {WHATSAPP_CONSOLE_SCRIPT}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ABA 3: ARQUIVO DE CHAT EXPORTADO (.TXT) */}
      {currentTab === 'file' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-500" />
                Extrair de Arquivo de Conversa (.txt do WhatsApp)
              </CardTitle>
              <CardDescription>
                No WhatsApp do celular, toque nos 3 pontinhos do grupo &gt; Mais &gt; Exportar conversa &gt; Sem mídia. Envie o arquivo <code>.txt</code> aqui.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 text-center cursor-pointer bg-muted/20 hover:bg-muted/30"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold mb-1">
                  {fileName ? `Arquivo: ${fileName}` : 'Clique para selecionar ou arraste o arquivo .txt aqui'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Suporta arquivos de log de conversas do WhatsApp (Brasil e exterior).
                </p>
              </div>

              {fileContacts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card">
                    <div>
                      <h4 className="font-semibold text-base flex items-center gap-2">
                        <span>{fileGroupName || 'Grupo Identificado'}</span>
                        <Badge tone="success">
                          {fileContacts.length} contatos encontrados
                        </Badge>
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Números identificados em mensagens, entradas e eventos do grupo.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportContactsToCSV(fileContacts, fileGroupName)}
                        className="gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" /> Baixar Excel/CSV
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleForwardToImport(fileContacts, fileGroupName)}
                        className="gap-1.5"
                      >
                        <ArrowRight className="h-3.5 w-3.5" /> Salvar no Sistema
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar por nome ou telefone..."
                        value={fileFilter}
                        onChange={(e) => setFileFilter(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>

                  <div className="border border-border rounded-lg max-h-72 overflow-y-auto">
                    <Table>
                      <THead>
                        <TR>
                          <TH>#</TH>
                          <TH>Nome / Autor</TH>
                          <TH>Telefone</TH>
                          <TH>Status</TH>
                          <TH>Mensagens</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filteredFileContacts.slice(0, 100).map((c, i) => (
                          <TR key={c.id}>
                            <TD className="text-xs text-muted-foreground">{i + 1}</TD>
                            <TD className="font-medium text-xs">{c.name || 'Participante'}</TD>
                            <TD className="font-mono text-xs">{c.formattedPhone}</TD>
                            <TD><ValidationBadge s={c.status} /></TD>
                            <TD className="text-xs text-muted-foreground">{c.messageCount || 1}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ABA 4: COLAGEM RÁPIDA */}
      {currentTab === 'paste' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Copy className="h-5 w-5 text-emerald-500" />
                Colagem Rápida de Participantes ou Telefones
              </CardTitle>
              <CardDescription>
                Copie o texto do cabeçalho do grupo no WhatsApp Web ou uma lista de telefones e cole abaixo. O sistema limpa, detecta nomes e normaliza tudo automaticamente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => handlePastedChange(e.target.value)}
                placeholder="Exemplo: Você, +55 11 98765-4321, Carlos, +55 21 99999-0000, +55 84 98888-1111..."
                className="w-full p-3 rounded-lg border border-input bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />

              {pastedContacts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card">
                    <div>
                      <h4 className="font-semibold text-base flex items-center gap-2">
                        <span>Contatos Identificados</span>
                        <Badge tone="success">
                          {pastedContacts.length} contatos
                        </Badge>
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Telefones limpos e prontos para exportação ou importação.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportContactsToCSV(pastedContacts, 'colagem_whatsapp')}
                        className="gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" /> Baixar Excel/CSV
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleForwardToImport(pastedContacts, 'Colagem WhatsApp')}
                        className="gap-1.5"
                      >
                        <ArrowRight className="h-3.5 w-3.5" /> Salvar no Sistema
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar contatos colados..."
                        value={pastedFilter}
                        onChange={(e) => setPastedFilter(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-input bg-background"
                      />
                    </div>
                  </div>

                  <div className="border border-border rounded-lg max-h-72 overflow-y-auto">
                    <Table>
                      <THead>
                        <TR>
                          <TH>#</TH>
                          <TH>Nome</TH>
                          <TH>Telefone</TH>
                          <TH>Status</TH>
                          <TH>Admin</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filteredPastedContacts.slice(0, 100).map((c, i) => (
                          <TR key={c.id}>
                            <TD className="text-xs text-muted-foreground">{i + 1}</TD>
                            <TD className="font-medium text-xs">{c.name || 'Sem nome'}</TD>
                            <TD className="font-mono text-xs">{c.formattedPhone}</TD>
                            <TD><ValidationBadge s={c.status} /></TD>
                            <TD className="text-xs">{c.isAdmin ? '⭐ Sim' : '-'}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
