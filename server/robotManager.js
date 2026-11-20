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

    // Filtra contatos com dígitos válidos, remove LIDs (IDs de privacidade do WhatsApp) e duplicações
    const uniqueMap = new Map();
    let lidCount = 0;

    for (const c of contacts) {
      let digits = (c.digits || c.phone || '').replace(/\D/g, '');

      // Detecção de LID (Linked Identity): IDs de 14-15 dígitos atribuídos pelo WhatsApp para mascarar telefones
      const isLid = digits.length >= 14 && !digits.startsWith('55');
      if (isLid) {
        lidCount++;
        continue;
      }

      // Auto-adiciona 55 se o número brasileiro estiver sem código do país (10-11 dígitos)
      if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
        digits = '55' + digits;
      }

      if (digits.length >= 10 && digits.length <= 13 && !uniqueMap.has(digits)) {
        uniqueMap.set(digits, {
          name: c.name || '',
          digits,
          phone: c.phone || digits,
        });
      }
    }

    if (lidCount > 0) {
      this.addLog(`⚠️ ${lidCount} contatos com ID de privacidade (LID) foram ignorados por não serem números telefônicos reais.`, 'warning');
    }

    const uniqueContacts = Array.from(uniqueMap.values());
    if (uniqueContacts.length === 0) {
      if (lidCount > 0) {
        throw new Error(`Todos os ${lidCount} contatos da lista possuem IDs de privacidade (LIDs) em vez de números de telefone reais. Extraia o grupo novamente abrindo a lista de membros no WhatsApp Web ou importe uma planilha com números reais.`);
      }
      throw new Error('Nenhum contato com número de telefone válido para adicionar.');
    }

    // Encontra o socket principal para resolver o grupo
    const mainChip = availableChips.find((c) => c.isMain) || availableChips[0];
    const mainSock = this.sockets.get(mainChip.index);

    this.addLog(`🔍 Verificando grupo de destino com ${mainChip.name}...`, 'info');
    const { groupJid, groupName } = await this.resolveGroup(mainSock, groupLinkOrJid);

    // Verifica se o robô é administrador do grupo para evitar bloqueio de adição
    try {
      const meta = await mainSock.groupMetadata(groupJid);
      const myJid = mainSock.user?.id || '';
      const myPhone = myJid.split(':')[0].replace(/\D/g, '');
      const isAdm = meta.participants?.some(
        (p) => (p.id?.includes(myPhone) || p.jid?.includes(myPhone)) && (p.admin === 'admin' || p.admin === 'superadmin')
      );
      if (!isAdm) {
        this.addLog(
          `⚠️ ATENÇÃO: O WhatsApp ${mainChip.name} (${myPhone}) NÃO é Admin de "${groupName}". Para adicionar contatos com sucesso, promova este número a Administrador do grupo!`,
          'warning'
        );
      } else {
        this.addLog(`👑 Confirmado: WhatsApp ${mainChip.name} é Administrador de "${groupName}".`, 'success');
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

      this.activeTask.currentIndex = i + 1;
      this.activeTask.currentChip = selectedChip.name;
      this.activeTask.currentContact = contact.name ? `${contact.name} (${contact.digits})` : contact.digits;

      // Monta o JID do participante
      const participantJid = `${contact.digits}@s.whatsapp.net`;

      try {
        this.addLog(`🔄 [${selectedChip.name} • ${selectedChip.phone || 'Ativo'}] Adicionando ${contact.name || contact.digits}...`, 'info');

        const result = await sock.groupParticipantsUpdate(groupJid, [participantJid], 'add');
        const resInfo = Array.isArray(result) ? result[0] : result;
        const statusCode = resInfo?.status || resInfo?.[participantJid]?.code || '200';

        if (statusCode === '200' || statusCode === 200) {
          selectedChip.addedToday++;
          this.activeTask.successCount++;
          this.addLog(`✅ [${selectedChip.name}] ${contact.name || contact.digits} adicionado(a) com sucesso! (${selectedChip.addedToday}/${dailyLimitPerChip} hoje)`, 'success');
        } else if (statusCode === '403' || statusCode === 403) {
          // Privacidade restrita pelo usuário - WhatsApp manda convite
          selectedChip.addedToday++;
          this.activeTask.successCount++;
          this.addLog(`✉️ [${selectedChip.name}] ${contact.name || contact.digits}: Privacidade restrita; convite direto enviado no privado.`, 'info');
        } else if (statusCode === '409' || statusCode === 409) {
          this.addLog(`ℹ️ [${selectedChip.name}] ${contact.name || contact.digits} já está no grupo.`, 'info');
        } else {
          this.activeTask.failedCount++;
          this.addLog(`⚠️ [${selectedChip.name}] Falha ao adicionar ${contact.digits} (Código ${statusCode}).`, 'warning');
        }
      } catch (err) {
        this.activeTask.failedCount++;
        this.addLog(`❌ [${selectedChip.name}] Erro ao adicionar ${contact.digits}: ${err.message}`, 'error');
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
}

export const robotManager = new RobotManager();
