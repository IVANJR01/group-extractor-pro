import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

class RobotManager {
  constructor() {
    this.chips = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      id: `chip-${i + 1}`,
      name: `WhatsApp ${i + 1}`,
      phone: '',
      isMain: i === 0,
      status: 'disconnected', // 'disconnected' | 'connecting' | 'qrcode' | 'pairing_code' | 'connected'
      qrCodeDataUrl: null,
      pairingCode: null,
      addedToday: 0,
      error: null,
      lastSeen: null,
    }));

    this.sockets = new Map(); // index -> sock
    this.userDisconnectedChips = new Set(); // índices desconectados intencionalmente pelo usuário
    this.logs = [];
    this.activeTask = {
      isRunning: false,
      isPaused: false,
      currentIndex: 0,
      totalContacts: 0,
      successCount: 0,
      failedCount: 0,
      currentChip: null,
      currentContact: null,
      nextAdditionInSeconds: 0,
      groupName: '',
      groupJid: '',
    };
    this.taskAbortController = null;

    // Tenta reconectar sessões salvas anteriormente
    this.initExistingSessions();
  }

  addLog(message, type = 'info') {
    const logItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      time: new Date().toLocaleTimeString('pt-BR'),
      message,
      type, // 'info' | 'success' | 'warning' | 'error'
    };
    this.logs.unshift(logItem);
    if (this.logs.length > 200) {
      this.logs.pop();
    }
  }

  async initExistingSessions() {
    try {
      const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('chip_')) {
          const index = parseInt(entry.name.replace('chip_', ''), 10);
          if (!isNaN(index) && index >= 0 && index < 6) {
            const credsPath = path.join(SESSIONS_DIR, entry.name, 'creds.json');
            if (fs.existsSync(credsPath)) {
              this.connectChip(index).catch((err) => {
                console.error(`Erro ao restaurar sessão chip ${index}:`, err);
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Erro ao verificar sessões existentes:', e);
    }
  }

  async connectChip(chipIndex, targetPhoneNumber = null) {
    if (chipIndex < 0 || chipIndex >= 6) {
      throw new Error(`Índice de chip inválido: ${chipIndex}`);
    }

    const chip = this.chips[chipIndex];
    const sessionDir = path.join(SESSIONS_DIR, `chip_${chipIndex}`);

    // Se vai usar pairing code, LIMPAR sessão antiga para evitar conflito de creds corrompido
    if (targetPhoneNumber) {
      try {
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          this.addLog(`🧹 Sessão antiga do ${chip.name} removida para nova conexão por código.`, 'info');
        }
      } catch {}
    }

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Se já havia um socket ativo, encerra antes de iniciar novo
    if (this.sockets.has(chipIndex)) {
      try {
        const oldSock = this.sockets.get(chipIndex);
        oldSock.ev.removeAllListeners();
        oldSock.end(undefined);
      } catch {}
      this.sockets.delete(chipIndex);
      // Pausa para dar tempo ao WhatsApp fechar a conexão antiga no servidor
      await new Promise((r) => setTimeout(r, 1000));
    }

    this.userDisconnectedChips.delete(chipIndex);
    chip.status = 'connecting';
    chip.error = null;
    chip.qrCodeDataUrl = null;
    chip.pairingCode = null;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Buscar a versão mais recente do protocolo WhatsApp para evitar rejeição
    let waVersion;
    try {
      const { version } = await fetchLatestBaileysVersion();
      waVersion = version;
      this.addLog(`📡 Usando WhatsApp Web v${version.join('.')}`, 'info');
    } catch {
      waVersion = undefined; // usa o default do Baileys
    }

    const sock = makeWASocket({
      auth: state,
      version: waVersion,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      // Browser fingerprint confiável - Ubuntu/Chrome evita bloqueio pelo WhatsApp
      browser: ['Ubuntu', 'Chrome', '22.04.4'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
    });

    this.sockets.set(chipIndex, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !sock.authState.creds.registered) {
        try {
          chip.qrCodeDataUrl = await QRCode.toDataURL(qr);
          if (chip.status !== 'pairing_code') {
            chip.status = 'qrcode';
          }
        } catch (qrErr) {
          console.error('Erro ao gerar QRCode:', qrErr);
        }
      }

      if (connection === 'open') {
        const userJid = sock.user?.id || '';
        const phone = userJid.split(':')[0].replace(/\D/g, '');
        chip.status = 'connected';
        chip.phone = phone;
        chip.qrCodeDataUrl = null;
        chip.pairingCode = null;
        chip.lastSeen = new Date().toISOString();
        chip.error = null;
        this.addLog(`🟢 WhatsApp ${chip.name} (${phone}) conectado com sucesso!`, 'success');
      } else if (connection === 'close') {
        // Se este socket já foi substituído por outro mais novo, ignora o fechamento antigo
        if (this.sockets.get(chipIndex) !== sock) {
          return;
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
        const shouldReconnect = !isReplaced && !isLoggedOut;

        chip.status = 'disconnected';
        chip.qrCodeDataUrl = null;
        chip.pairingCode = null;

        if (isLoggedOut) {
          chip.phone = '';
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch {}
          this.addLog(`🔴 WhatsApp ${chip.name} desconectado (Sessão encerrada no celular).`, 'warning');
        } else if (isReplaced) {
          // Erro 440: Outra sessão assumiu a conexão ou foi substituída. Não reconectar em loop.
          this.addLog(`⚠️ WhatsApp ${chip.name} desconectado (Código 440 - Sessão substituída). Aguarde antes de reconectar.`, 'warning');
        } else {
          this.addLog(`⚠️ WhatsApp ${chip.name} desconectado temporariamente (Código ${statusCode || 'n/a'}).`, 'info');
          if (shouldReconnect && !this.userDisconnectedChips.has(chipIndex)) {
            setTimeout(() => {
              if (this.chips[chipIndex].status === 'disconnected' && !this.userDisconnectedChips.has(chipIndex) && this.sockets.get(chipIndex) === sock) {
                this.connectChip(chipIndex).catch(() => {});
              }
            }, 8000);
          }
        }
      }
    });

    // Se o usuário solicitou emparelhamento por número de telefone (Sem Câmera)
    if (targetPhoneNumber && !sock.authState.creds.registered) {
      let cleanPhone = targetPhoneNumber.replace(/\D/g, '');
      // Auto-adicionar código do Brasil (55) se o número tiver 10-11 dígitos (DDD + telefone)
      if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
        this.addLog(`📱 Número ${cleanPhone} detectado sem código do país. Adicionando 55 automaticamente → ${('55' + cleanPhone)}`, 'info');
        cleanPhone = '55' + cleanPhone;
      }
      chip.status = 'connecting';
      // Aguarda 5 segundos para o socket estabelecer o handshake completo com o WhatsApp
      this.addLog(`⏳ Aguardando handshake com servidor WhatsApp para ${cleanPhone}...`, 'info');
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        chip.pairingCode = code;
        chip.status = 'pairing_code';
        this.addLog(`⚡ Código de emparelhamento gerado para o número ${cleanPhone}: ${code}`, 'info');
        return { pairingCode: code };
      } catch (err) {
        console.error('Erro ao gerar código de emparelhamento:', err);
        chip.error = `Erro ao gerar código: ${err.message || 'Tente novamente'}`;
        chip.status = 'disconnected';
        throw err;
      }
    }

    return { status: chip.status };
  }

  async disconnectChip(chipIndex, clearCredentials = true) {
    if (chipIndex < 0 || chipIndex >= 6) return;
    this.userDisconnectedChips.add(chipIndex);
    const chip = this.chips[chipIndex];

    if (this.sockets.has(chipIndex)) {
      try {
        const sock = this.sockets.get(chipIndex);
        sock.end(undefined);
      } catch {}
      this.sockets.delete(chipIndex);
    }

    chip.status = 'disconnected';
    chip.phone = '';
    chip.qrCodeDataUrl = null;
    chip.pairingCode = null;
    chip.error = null;

    if (clearCredentials) {
      const sessionDir = path.join(SESSIONS_DIR, `chip_${chipIndex}`);
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {}
    }

    this.addLog(`🔌 WhatsApp ${chip.name} foi desconectado e removido.`, 'info');
    return { ok: true };
  }

  async disconnectAll() {
    for (let i = 0; i < 6; i++) {
      await this.disconnectChip(i, true);
    }
    this.addLog('🔌 Todos os WhatsApps do robô foram desconectados.', 'info');
    return { ok: true };
  }

  getStatus() {
    return {
      chips: this.chips,
      activeTask: this.activeTask,
      logs: this.logs.slice(0, 50),
    };
  }

  // RESOLVER GRUPO DE DESTINO (Link de convite ou JID)
  async resolveGroup(sock, groupLinkOrJid) {
    const trimmed = groupLinkOrJid.trim();

    // Se já é JID @g.us
    if (trimmed.endsWith('@g.us')) {
      return { groupJid: trimmed, groupName: 'Grupo de Destino' };
    }

    // Se for link de convite: https://chat.whatsapp.com/Czqp9FJaYnc85U2eXnuKJN
    const match = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
    if (!match) {
      throw new Error('Link de grupo inválido. Use um link do tipo https://chat.whatsapp.com/...');
    }

    const inviteCode = match[1];
    try {
      const groupInfo = await sock.groupGetInviteInfo(inviteCode);
      const groupJid = groupInfo.id;
      const groupName = groupInfo.subject || 'Grupo de Destino';

      // Verifica se o sock já está no grupo; se não estiver, entra
      try {
        await sock.groupAcceptInvite(inviteCode);
      } catch (acceptErr) {
        // Se já está no grupo ou outro erro não fatal
      }

      return { groupJid, groupName, inviteCode };
    } catch (err) {
      throw new Error(`Falha ao obter dados do grupo via link: ${err.message}`);
    }
  }

  // INICIAR ADIÇÃO AUTOMÁTICA EM MASSA COM REVEZAMENTO
  async startAddingContacts({
    groupLinkOrJid,
    contacts = [],
    delaySeconds = 20,
    dailyLimitPerChip = 20,
  }) {
    if (this.activeTask.isRunning) {
      throw new Error('Já existe uma adição em andamento. Pause ou pare a tarefa atual.');
    }

    // Filtra chips conectados
    const availableChips = this.chips.filter(
      (c) => c.status === 'connected' && this.sockets.has(c.index)
    );

    if (availableChips.length === 0) {
      throw new Error('Nenhum WhatsApp conectado no robô! Conecte pelo menos 1 número.');
    }

    // Processa contatos com dígitos válidos (suporta tanto telefones reais quanto LIDs)
    const uniqueMap = new Map();
    let lidCount = 0;
    let phoneCount = 0;

    for (const c of contacts) {
      let digits = (c.digits || c.phone || '').replace(/\D/g, '');
      if (!digits || digits.length < 8) continue;

      let isLid = false;

      // Classifica se é telefone BR ou LID de privacidade
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        phoneCount++;
      } else if (digits.length === 10 || digits.length === 11) {
        digits = '55' + digits;
        phoneCount++;
      } else if (digits.length >= 14) {
        isLid = true;
        lidCount++;
      } else {
        phoneCount++;
      }

      const rawName = (c.name || '').trim();
      const cleanName = !/^(não|nao|sim|admin|membro)$/i.test(rawName) ? rawName : '';

      if (!uniqueMap.has(digits)) {
        uniqueMap.set(digits, {
          name: cleanName,
          digits,
          phone: digits,
          isLid,
        });
      }
    }

    if (lidCount > 0 && phoneCount > 0) {
      this.addLog(`ℹ️ Lista processada: ${phoneCount} telefones e ${lidCount} IDs de privacidade (LID). Suporte dual ativado.`, 'info');
    } else if (lidCount > 0) {
      this.addLog(`ℹ️ Lista com ${lidCount} IDs de privacidade (LID). O robô adicionará via endereçamento @lid com fallback automático.`, 'info');
    }

    const uniqueContacts = Array.from(uniqueMap.values());
    if (uniqueContacts.length === 0) {
      throw new Error('Nenhum contato válido encontrado na lista para adicionar.');
    }

    // Encontra o socket principal para resolver o grupo
    const mainChip = availableChips.find((c) => c.isMain) || availableChips[0];
    const mainSock = this.sockets.get(mainChip.index);

    this.addLog(`🔍 Verificando grupo de destino com ${mainChip.name}...`, 'info');
    const { groupJid, groupName, inviteCode } = await this.resolveGroup(mainSock, groupLinkOrJid);

    // Verifica status de administrador da conta no grupo
    try {
      const meta = await mainSock.groupMetadata(groupJid);
      const myJid = mainSock.user?.id || '';
      const myLid = mainSock.user?.lid || '';
      const myPhone = myJid.split(':')[0].replace(/\D/g, '');
      const myLidDigits = myLid.split(':')[0].replace(/\D/g, '');

      const isAdm = meta.participants?.some((p) => {
        const pJid = p.id || p.jid || '';
        const matchesMe = (myPhone && pJid.includes(myPhone)) || (myLidDigits && pJid.includes(myLidDigits));
        return matchesMe && (p.admin === 'admin' || p.admin === 'superadmin');
      });

      if (isAdm) {
        this.addLog(`👑 Confirmado: WhatsApp ${mainChip.name} (${myPhone || 'Você'}) é Administrador de "${groupName}".`, 'success');
      } else {
        this.addLog(`👑 WhatsApp ${mainChip.name} (${myPhone || 'Você'}) pronto no grupo "${groupName}".`, 'info');
      }
    } catch (checkAdmErr) {
      // Ignora erro de leitura de metadados se ocorrer
    }

    this.activeTask = {
      isRunning: true,
      isPaused: false,
      currentIndex: 0,
      totalContacts: uniqueContacts.length,
      successCount: 0,
      failedCount: 0,
      currentChip: mainChip.name,
      currentContact: null,
      nextAdditionInSeconds: 0,
      groupName,
      groupJid,
      inviteCode: inviteCode || '',
      inviteUrl: groupLinkOrJid,
    };

    this.taskAbortController = new AbortController();

    this.addLog(
      `🚀 Robô iniciado! ${uniqueContacts.length} contatos únicos para adicionar em "${groupName}". Revezando entre ${availableChips.length} WhatsApp(s) com delay anti-ban de ${delaySeconds}s.`,
      'success'
    );

    // Executa em segundo plano
    this.runAddingLoop({
      groupJid,
      contacts: uniqueContacts,
      delaySeconds,
      dailyLimitPerChip,
      abortSignal: this.taskAbortController.signal,
    });

    return { ok: true, groupName, groupJid, total: uniqueContacts.length };
  }

  async runAddingLoop({ groupJid, contacts, delaySeconds, dailyLimitPerChip, abortSignal }) {
    let chipPointer = 0;

    for (let i = 0; i < contacts.length; i++) {
      if (abortSignal.aborted) {
        this.addLog('⏹️ Adição automática interrompida pelo usuário.', 'warning');
        break;
      }

      // Loop de pausa
      while (this.activeTask.isPaused && !abortSignal.aborted) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (abortSignal.aborted) break;

      // Seleciona o próximo chip conectado que ainda não atingiu o limite
      const activeChips = this.chips.filter(
        (c) => c.status === 'connected' && this.sockets.has(c.index)
      );

      if (activeChips.length === 0) {
        this.addLog('❌ Todos os WhatsApps foram desconectados. Tarefa pausada.', 'error');
        this.activeTask.isPaused = true;
        break;
      }

      const eligibleChips = activeChips.filter((c) => c.addedToday < dailyLimitPerChip);
      if (eligibleChips.length === 0) {
        this.addLog('⚠️ Todos os WhatsApps conectados atingiram a meta diária (anti-ban)! Tarefa finalizada pelo limite diário.', 'warning');
        break;
      }

      // Pega o próximo chip com revezamento justo
      const selectedChip = eligibleChips[chipPointer % eligibleChips.length];
      chipPointer++;

      const sock = this.sockets.get(selectedChip.index);
      const contact = contacts[i];
      const displayName = contact.name ? `${contact.name} (${contact.digits})` : contact.digits;

      this.activeTask.currentIndex = i + 1;
      this.activeTask.currentChip = selectedChip.name;
      this.activeTask.currentContact = displayName;

      const isLid = contact.isLid || contact.digits.length >= 14;

      if (isLid) {
        // LIDs são identificadores de privacidade do WhatsApp. O WhatsApp não permite interação
        // direta com LIDs sem que a pessoa esteja na agenda, e derruba a sessão se tentar forçar.
        // Ignoramos com segurança para manter a conexão estável.
        this.activeTask.failedCount++;
        this.addLog(
          `⚠️ [${selectedChip.name}] ${displayName}: Ignorado por segurança (ID de privacidade LID). Adicione contatos com números de telefone reais (10 a 13 dígitos) para entrar no grupo.`,
          'warning'
        );
        continue;
      }

      // Contatos com número de telefone real (10 a 13 dígitos):
      const cleanDigits = contact.digits.length <= 11 ? '55' + contact.digits : contact.digits;
      const participantJid = `${cleanDigits}@s.whatsapp.net`;

      try {
        this.addLog(`🔄 [${selectedChip.name} • ${selectedChip.phone || 'Ativo'}] Adicionando ${displayName}...`, 'info');

        let statusCode = '200';
        const result = await sock.groupParticipantsUpdate(groupJid, [participantJid], 'add');
        const resInfo = Array.isArray(result) ? result[0] : result;
        statusCode = String(resInfo?.status || resInfo?.[participantJid]?.code || '200');

        if (statusCode === '200') {
          selectedChip.addedToday++;
          this.activeTask.successCount++;
          this.addLog(`✅ [${selectedChip.name}] ${displayName} adicionado(a) com sucesso ao grupo! (${selectedChip.addedToday}/${dailyLimitPerChip} hoje)`, 'success');
        } else if (statusCode === '403') {
          // Usuário com privacidade restrita: o WhatsApp envia convite no privado automaticamente
          selectedChip.addedToday++;
          this.activeTask.successCount++;
          this.addLog(`✉️ [${selectedChip.name}] ${displayName}: Privacidade restrita; convite direto enviado no privado pelo WhatsApp.`, 'info');
        } else if (statusCode === '409') {
          this.addLog(`ℹ️ [${selectedChip.name}] ${displayName} já está no grupo.`, 'info');
        } else if (statusCode === '404') {
          this.activeTask.failedCount++;
          this.addLog(`⚠️ [${selectedChip.name}] ${displayName}: Número inexistente ou não registrado no WhatsApp (Código 404).`, 'warning');
        } else {
          this.activeTask.failedCount++;
          this.addLog(`⚠️ [${selectedChip.name}] Falha ao adicionar ${displayName} (Código ${statusCode}).`, 'warning');
        }
      } catch (err) {
        this.activeTask.failedCount++;
        const msg = String(err.message || err);
        if (msg.includes('account_reachout_restricted')) {
          this.addLog(
            `⚠️ [${selectedChip.name}] Restrição temporária da Meta (account_reachout_restricted): Este número não pode adicionar contatos desconhecidos fora da agenda. Conecte outro WhatsApp (Chip 2/3) ou salve os contatos na agenda do celular via arquivo VCF!`,
            'warning'
          );
        } else if (msg.includes('bad-request')) {
          this.addLog(
            `❌ [${selectedChip.name}] O WhatsApp recusou a adição de ${displayName} (bad-request).`,
            'error'
          );
        } else {
          this.addLog(`❌ [${selectedChip.name}] Erro ao adicionar ${displayName}: ${msg}`, 'error');
        }
      }

      // Se ainda houver contatos e não estiver cancelado, aguarda delay anti-ban
      if (i < contacts.length - 1 && !abortSignal.aborted) {
        // Variação humanizada de ±3 segundos no delay
        const jitter = Math.floor(Math.random() * 7) - 3;
        const totalDelay = Math.max(5, delaySeconds + jitter);

        for (let s = totalDelay; s > 0; s--) {
          if (abortSignal.aborted) break;
          while (this.activeTask.isPaused && !abortSignal.aborted) {
            await new Promise((r) => setTimeout(r, 1000));
          }
          this.activeTask.nextAdditionInSeconds = s;
          await new Promise((r) => setTimeout(r, 1000));
        }
        this.activeTask.nextAdditionInSeconds = 0;
      }
    }

    this.activeTask.isRunning = false;
    this.activeTask.nextAdditionInSeconds = 0;
    this.addLog(`🏁 Tarefa concluída! Total processado: ${this.activeTask.currentIndex}. Adicionados com sucesso: ${this.activeTask.successCount}.`, 'success');
  }

  pauseTask() {
    if (this.activeTask.isRunning) {
      this.activeTask.isPaused = true;
      this.addLog('⏸️ Tarefa pausada pelo usuário.', 'info');
    }
  }

  resumeTask() {
    if (this.activeTask.isRunning && this.activeTask.isPaused) {
      this.activeTask.isPaused = false;
      this.addLog('▶️ Tarefa retomada pelo usuário.', 'info');
    }
  }

  stopTask() {
    if (this.taskAbortController) {
      this.taskAbortController.abort();
    }
    this.activeTask.isRunning = false;
    this.activeTask.isPaused = false;
    this.activeTask.nextAdditionInSeconds = 0;
    this.addLog('⏹️ Tarefa cancelada.', 'warning');
  }

  clearLogs() {
    this.logs = [];
  }

  // Envia arquivo VCF diretamente para o WhatsApp do usuário para salvar na agenda com 1 toque
  async sendVcfToMyWhatsApp(chipIndex = 0) {
    const chip = this.chips[chipIndex];
    if (!chip || chip.status !== 'connected' || !this.sockets.has(chipIndex)) {
      throw new Error('Nenhum WhatsApp conectado no robô.');
    }

    const sock = this.sockets.get(chipIndex);
    const myJid = sock.user?.id || '';
    if (!myJid) throw new Error('Identificador do WhatsApp não encontrado.');

    const vcfPath = 'C:\\Users\\ivanj\\Downloads\\contatos_agenda_3mpro.vcf';
    if (!fs.existsSync(vcfPath)) {
      throw new Error('Arquivo de agenda contatos_agenda_3mpro.vcf não encontrado em Downloads.');
    }

    const vcfBuffer = fs.readFileSync(vcfPath);

    this.addLog(`⏳ Enviando arquivo da agenda (.vcf com 553 contatos) para o seu próprio WhatsApp...`, 'info');

    // Envia o documento para o próprio WhatsApp do usuário
    await sock.sendMessage(myJid, {
      document: vcfBuffer,
      fileName: 'contatos_agenda_3mpro.vcf',
      mimetype: 'text/vcard',
      caption: '📲 Toque neste arquivo acima no seu WhatsApp e clique em "Salvar / Importar todos" para colocar os 553 contatos na sua agenda em 1 segundo!\n\nDepois que salvar, o WhatsApp permite adicionar todos ao grupo sem nenhuma restrição.',
    });

    this.addLog(`📲 Sucesso! Arquivo VCF enviado diretamente para o seu WhatsApp (${chip.phone}). Abra o WhatsApp no celular e toque no arquivo para salvar na agenda!`, 'success');

    return { ok: true, phone: chip.phone };
  }
}

export const robotManager = new RobotManager();
