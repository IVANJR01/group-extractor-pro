// Group Extractor Pro - WhatsApp Web Content Script (Extrator Profundo v2.2)

(function () {
  'use strict';

  if (window.__gep_injected_v22) return;
  window.__gep_injected_v22 = true;

  console.log('%c[Group Extractor Pro v2.2]%c Extrator carregado com suporte a exclusão de administradores e envio direto ao sistema.', 'color: #10b981; font-weight: bold;', 'color: inherit;');

  let isExtracting = false;
  let abortExtraction = false;

  // Injetar botão flutuante se não existir
  function injectFloatingButton() {
    if (document.getElementById('gep-floating-trigger')) return;

    const btn = document.createElement('button');
    btn.id = 'gep-floating-trigger';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Extrair Grupo Completo</span>
    `;
    btn.title = 'Extrair TODOS os participantes deste grupo (mesmo grupos de 500+ membros)';
    btn.addEventListener('click', handleExtractClick);
    document.body.appendChild(btn);
  }

  // Capturar nome do grupo ativo
  function getGroupName() {
    // 1. Prioriza o cabeçalho principal da conversa ativa (#main header)
    const header = document.querySelector('#main header, div[data-testid="conversation-header"], header');
    if (header) {
      const titleEl = header.querySelector('div[role="button"] span[title], span[data-testid="conversation-info-header-chat-title"], span[title]');
      if (titleEl) {
        const val = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
        if (val && !val.includes(',') && !val.includes('+') && !/wa-wordmark|wordmark/i.test(val)) {
          return val;
        }
      }
      for (const s of header.querySelectorAll('span[dir="auto"], span[title]')) {
        const t = (s.getAttribute('title') || s.textContent || '').trim();
        if (t && !t.includes(',') && !t.includes('+') && !t.toLowerCase().includes('online') && !/wa-wordmark|wordmark/i.test(t) && t.length > 1) {
          return t;
        }
      }
    }

    // 2. Busca no painel lateral de dados do grupo
    const drawer = document.querySelector('div[data-testid="chat-info-drawer"]');
    if (drawer) {
      const candidates = drawer.querySelectorAll('h2, span[dir="auto"]');
      for (const el of candidates) {
        const text = (el.getAttribute('title') || el.textContent || '').trim();
        if (text && !text.includes('Dados do grupo') && !text.includes('membros') && !/wa-wordmark|wordmark/i.test(text) && text.length > 2) {
          return text;
        }
      }
    }

    return 'Grupo WhatsApp';
  }

  // Capturar total esperado de membros (ex: 774 membros)
  function getExpectedMembersCount() {
    const textSources = [
      document.querySelector('div[data-testid="chat-info-drawer"]')?.textContent || '',
      document.querySelector('#main header')?.textContent || '',
      document.body.textContent || ''
    ];
    for (const t of textSources) {
      const match = t.match(/(\d[\d.\s]*)\s*(?:membros|participantes|members|participants)/i);
      if (match) {
        const num = parseInt(match[1].replace(/\D/g, ''), 10);
        if (num > 0) return num;
      }
    }
    return 0;
  }

  // DDDs oficiais da Anatel no Brasil (67 códigos de área)
  const VALID_BR_DDDS = new Set([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99'
  ]);

  function cleanPhoneNumber(raw) {
    if (!raw) return '';
    let digits = String(raw).replace(/@.*$/, '').replace(/\D/g, '');

    // Descartar LIDs (14-15 dígitos são identificadores de privacidade do WhatsApp)
    if (digits.length >= 14) return '';

    // Normalização brasileira inteligente (Injeção automática do 9º dígito)
    if (digits.startsWith('55')) {
      const national = digits.slice(2);
      // 10 dígitos nacionais = 2 dígitos de DDD + 8 dígitos de assinante (ex: 54 8103-1641)
      if (national.length === 10) {
        const ddd = national.slice(0, 2);
        const sub = national.slice(2);
        // Celulares no Brasil iniciam com 6, 7, 8 ou 9
        if (/^[6-9]/.test(sub)) {
          digits = `55${ddd}9${sub}`;
        }
      }
      // Validação de DDD oficial: descarta LIDs fatiados ou números corrompidos
      if (digits.length === 13) {
        const ddd = digits.slice(2, 4);
        if (!VALID_BR_DDDS.has(ddd)) return '';
      }
    } else {
      // Sem código de país 55
      if (digits.length === 10) {
        const ddd = digits.slice(0, 2);
        const sub = digits.slice(2);
        if (/^[6-9]/.test(sub)) {
          digits = `55${ddd}9${sub}`;
        } else {
          digits = `55${digits}`;
        }
      } else if (digits.length === 11) {
        digits = `55${digits}`;
      }
      if (digits.startsWith('55') && digits.length === 13) {
        const ddd = digits.slice(2, 4);
        if (!VALID_BR_DDDS.has(ddd)) return '';
      }
    }

    return digits;
  }

  function formatPhoneDisplay(digits) {
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length === 13) {
      const ddd = digits.slice(2, 4);
      return `+55 (${ddd}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    if (digits.startsWith('55') && digits.length === 12) {
      const ddd = digits.slice(2, 4);
      return `+55 (${ddd}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }
    if (digits.length >= 10) return `+${digits}`;
    return digits;
  }

  function extractPhoneFromRow(row) {
    const text = row.textContent || '';
    // 1. Procura número com '+' (padrão nativo do WhatsApp para membros que não estão na agenda)
    const plusMatch = text.match(/\+\s*\d{1,3}[\d\s().-]{7,25}\d/);
    if (plusMatch) return plusMatch[0].trim();

    // 2. Procura em atributos title de spans
    for (const el of row.querySelectorAll('span[title], div[title]')) {
      const title = (el.getAttribute('title') || '').trim();
      if (title.startsWith('+') || /^\d{10,13}$/.test(title.replace(/\D/g, ''))) {
        return title;
      }
    }

    // 3. Procura padrão brasileiro geral com DDD
    const brMatch = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4,5}[-\s]?\d{4}/);
    if (brMatch) return brMatch[0].trim();

    return '';
  }

  function cleanName(raw, digits) {
    if (!raw) return '';
    let n = String(raw).trim();
    // Remove ~ no início
    n = n.replace(/^~+\s*/, '');
    // Remove o telefone se estiver junto do nome (ex: "Adriana +55 91 9809-4310")
    n = n.replace(/\+?\s*\d{1,3}[\d\s().-]{7,25}\d/g, '').trim();
    // Remove palavras de status / sistema
    n = n.replace(/\b(admin do grupo|admin|administrador|superadmin|membro)\b/gi, '').trim();
    // Remove pontuações soltas nas bordas
    n = n.replace(/^[-–—|,;:\s]+|[-–—|,;:\s]+$/g, '').trim();

    // Se só sobraram dígitos de telefone ou ficou vazio, não é um nome
    const onlyDigits = n.replace(/\D/g, '');
    if (!n || (onlyDigits.length >= 8 && digits && onlyDigits.includes(digits.slice(-8)))) {
      return '';
    }
    return n;
  }

  function extractNameFromRow(row, rawPhone, digits) {
    // 1. Procura em elementos cujo title comece com ~
    for (const el of row.querySelectorAll('[title]')) {
      const title = (el.getAttribute('title') || '').trim();
      if (title.startsWith('~') && title.length > 1) {
        const name = cleanName(title, digits);
        if (name) return name;
      }
    }

    // 2. Procura em spans com dir="auto" ou texto começando com ~
    for (const el of row.querySelectorAll('span[dir="auto"], span, div')) {
      const text = (el.textContent || '').trim();
      if (text.startsWith('~') && text.length > 1) {
        const name = cleanName(text, digits);
        if (name) return name;
      }
    }

    // 3. Procura no Fiber do elemento para pegar notifyName / pushname oficial
    try {
      const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        let curr = row[fiberKey];
        let depth = 0;
        while (curr && depth < 25) {
          const p = curr.memoizedProps;
          if (p) {
            const contact = p.contact || p.user || p.participant;
            const possibleName = contact?.pushname || contact?.notifyName || contact?.name || contact?.formattedName || p.pushname || p.notifyName;
            if (possibleName) {
              const name = cleanName(possibleName, digits);
              if (name) return name;
            }
          }
          curr = curr.return;
          depth++;
        }
      }
    } catch {}

    // 4. Qualquer span que não seja o telefone nem admin
    for (const span of row.querySelectorAll('span[dir="auto"], span[title]')) {
      const t = (span.getAttribute('title') || span.textContent || '').trim();
      if (t && !t.includes('+') && !/admin/i.test(t) && !/membro/i.test(t) && (!rawPhone || !rawPhone.includes(t)) && t.length > 1) {
        const name = cleanName(t, digits);
        if (name) return name;
      }
    }

    return '';
  }

  // TÉCNICA 1: Tentar extrair do React Fiber / Memória (Apenas números reais c.us)
  function extractFromMemory() {
    try {
      const candidates = [
        document.querySelector('#main header'),
        document.querySelector('div[data-testid="chat-info-drawer"]'),
        document.querySelector('#main'),
        document.querySelector('div[data-testid="conversation-header"]'),
        document.querySelector('#app')
      ].filter(Boolean);

      for (const el of candidates) {
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fiberKey) continue;

        let curr = el[fiberKey];
        let depth = 0;
        while (curr && depth < 100) {
          const p = curr.memoizedProps;
          if (p) {
            const gm = p.groupMetadata || p.chat?.groupMetadata;
            if (gm) {
              const list = gm.participants?._models || gm.participants?.models || (Array.isArray(gm.participants) ? gm.participants : null);
              if (list && list.length > 0) {
                return {
                  groupName: p.chat?.name || p.chat?.formattedTitle || gm.subject || null,
                  list
                };
              }
            }
            if (p.participants) {
              const list = p.participants?._models || p.participants?.models || (Array.isArray(p.participants) ? p.participants : null);
              if (list && list.length > 0) {
                return { groupName: p.chat?.name || null, list };
              }
            }
          }
          curr = curr.return;
          depth++;
        }
      }
    } catch (e) {}
    return null;
  }

  // TÉCNICA 2: Abrir Pesquisar Membros e rolar lista no painel visual (FONTE DA VERDADE)
  async function extractDeepFromDrawerDOM(totalExpected, onProgress) {
    const contactsMap = new Map();
    const header = document.querySelector('#main header, div[data-testid="conversation-header"], header');

    let drawer = document.querySelector('div[data-testid="chat-info-drawer"], div[tabindex="-1"]');
    if (!drawer && header) {
      (header.querySelector('div[role="button"]') || header).click();
      await new Promise(r => setTimeout(r, 600));
      drawer = document.querySelector('div[data-testid="chat-info-drawer"], div[tabindex="-1"]');
    }

    onProgress(0, totalExpected, 'Abrindo lista de participantes...');

    let activeModal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    if (!activeModal && drawer) {
      const buttons = drawer.querySelectorAll('div[role="button"], span[role="button"], button');
      for (const btn of buttons) {
        const text = btn.textContent || '';
        const title = btn.getAttribute('title') || '';
        if (/pesquisar/i.test(title) || /pesquisar/i.test(text) || (/ver todos|ver tudo|membros/i.test(text) && /\d+/.test(text))) {
          btn.click();
          await new Promise(r => setTimeout(r, 600));
          break;
        }
      }
      activeModal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    }

    const scrollTarget = activeModal || drawer;
    if (!scrollTarget) return [];

    let listScroll = scrollTarget;
    for (const d of scrollTarget.querySelectorAll('div')) {
      const s = window.getComputedStyle(d);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 50) {
        listScroll = d;
        break;
      }
    }

    let noNewCount = 0;
    let prevCount = 0;

    for (let i = 0; i < 350; i++) {
      if (abortExtraction) break;

      const rows = (activeModal || drawer || document.body).querySelectorAll('div[role="listitem"], div[data-testid="cell-frame-container"]');
      for (const row of rows) {
        const text = row.textContent || '';
        const isAdmin = /admin/i.test(text);
        const rawPhone = extractPhoneFromRow(row);
        const digits = cleanPhoneNumber(rawPhone);

        if (digits && digits.length >= 10 && digits.length <= 13) {
          const name = extractNameFromRow(row, rawPhone, digits);
          if (!contactsMap.has(digits)) {
            contactsMap.set(digits, {
              name,
              rawPhone,
              digits,
              formatted: formatPhoneDisplay(digits),
              isAdmin
            });
          } else if (name && !contactsMap.get(digits).name) {
            contactsMap.get(digits).name = name;
          }
        }
      }

      onProgress(contactsMap.size, totalExpected, `Varrendo participantes: ${contactsMap.size}${totalExpected ? ' de ' + totalExpected : ''}...`);

      if (totalExpected > 0 && contactsMap.size >= totalExpected) break;

      if (contactsMap.size === prevCount) {
        if (++noNewCount >= 14) break;
      } else {
        noNewCount = 0;
        prevCount = contactsMap.size;
      }

      if (listScroll) {
        listScroll.scrollTop += 600;
      }
      await new Promise(r => setTimeout(r, 130));
    }

    return Array.from(contactsMap.values());
  }

  // Fallback de cabeçalho
  function extractFromHeaderSubtitle() {
    const header = document.querySelector('#main header');
    if (!header) return [];
    for (const span of header.querySelectorAll('span[title]')) {
      const t = span.getAttribute('title') || '';
      if (t.includes(',') && (t.includes('+') || /\d{4}/.test(t))) {
        const results = [];
        for (const item of t.split(/[,;]+/)) {
          const digits = cleanPhoneNumber(item);
          if (digits && digits.length >= 10 && digits.length <= 13) {
            results.push({ name: '', rawPhone: item, digits, formatted: formatPhoneDisplay(digits), isAdmin: false });
          }
        }
        if (results.length > 0) return results;
      }
    }
    return [];
  }

  // HANDLER PRINCIPAL DO CLIQUE
  async function handleExtractClick() {
    if (isExtracting) return;
    isExtracting = true;
    abortExtraction = false;

    let groupName = getGroupName();
    const totalExpected = getExpectedMembersCount();

    showModalLoading(groupName, totalExpected);

    try {
      let finalContacts = [];

      // 1. Prioridade 1: Varredura visual profunda do DOM (lê telefones reais visíveis na tela)
      const domContacts = await extractDeepFromDrawerDOM(totalExpected, (current, total, statusText) => {
        updateModalProgress(current, total, statusText);
      });

      if (domContacts && domContacts.length > 0) {
        finalContacts = domContacts;
      }

      // 2. Se o DOM pegou menos que o esperado, complementar com contatos reais da memória (sem LIDs!)
      if (finalContacts.length < (totalExpected || 30)) {
        const memoryResult = extractFromMemory();
        if (memoryResult && memoryResult.list?.length > 0) {
          if (memoryResult.groupName && !groupName) groupName = memoryResult.groupName;
          const map = new Map();
          for (const c of finalContacts) map.set(c.digits, c);

          for (const item of memoryResult.list) {
            let rawPhone = '';
            if (item.phoneNumber) {
              rawPhone = item.phoneNumber;
            } else if (item.pnJid) {
              const jidStr = typeof item.pnJid === 'object' ? (item.pnJid.user || '') : String(item.pnJid || '');
              if (!jidStr.includes('lid')) rawPhone = jidStr;
            } else if (item.contact?.phoneNumber) {
              rawPhone = item.contact.phoneNumber;
            } else if (item.contact?.id && (item.contact.id.server === 'c.us' || !String(item.contact.id.server || '').includes('lid'))) {
              const idStr = String(item.contact.id._serialized || item.contact.id.user || '');
              if (!idStr.includes('lid')) rawPhone = typeof item.contact.id === 'object' ? item.contact.id.user : item.contact.id;
            }

            const digits = cleanPhoneNumber(rawPhone);
            if (digits && digits.length >= 10 && digits.length <= 13) {
              const isAdmin = Boolean(item.isAdmin || item.isSuperAdmin || item.role === 'admin');
              const c = item.contact || {};
              const name = cleanName(c.notifyName || c.pushname || c.name || c.formattedName || item.notifyName || item.pushname || item.displayName || item.name || '', digits);
              if (!map.has(digits)) {
                map.set(digits, { name, rawPhone: digits, digits, formatted: formatPhoneDisplay(digits), isAdmin });
              }
            }
          }
          finalContacts = Array.from(map.values());
        }
      }

      // 3. Fallback
      if (finalContacts.length === 0) {
        finalContacts = extractFromHeaderSubtitle();
      }

      if (finalContacts.length === 0) {
        alert(`Não foi possível extrair os membros do grupo "${groupName}". Por favor, abra os "Dados do grupo" e tente novamente.`);
        closeModal();
        return;
      }

      // Envia automaticamente para a API local em segundo plano
      syncWithLocalApp(groupName, finalContacts, totalExpected);

      renderModalResults(groupName, finalContacts, totalExpected);
    } catch (err) {
      console.error('[Group Extractor Pro] Erro ao extrair:', err);
      alert('Erro ao extrair: ' + err.message);
      closeModal();
    } finally {
      isExtracting = false;
    }
  }

  function syncWithLocalApp(groupName, contacts, totalExpected) {
    const payload = { groupName, contacts, totalExpected };

    // 1. Envio via Background Service Worker (100% imune ao CSP do WhatsApp Web)
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        chrome.runtime.sendMessage({ action: 'sync_with_local_app', data: payload }, () => {
          if (chrome.runtime.lastError) {
            fallbackSync(payload);
          }
        });
        return;
      } catch (e) {
        fallbackSync(payload);
      }
    } else {
      fallbackSync(payload);
    }
  }

  function fallbackSync(payload) {
    try {
      fetch('http://localhost:5173/api/extracted-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}
  }

  function showModalLoading(groupName, totalExpected) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'gep-modal-overlay';
    overlay.innerHTML = `
      <div id="gep-modal-card">
        <div class="gep-header">
          <h2 class="gep-title">
            <span>Extraindo Grupo</span>
            <span class="gep-badge" style="background:#10b981;color:#fff;">${escapeHtml(groupName)}</span>
          </h2>
          <button class="gep-close" id="gep-btn-close">&times;</button>
        </div>
        <div class="gep-body" style="text-align: center; padding: 36px 20px;">
          <div class="gep-spinner" style="width: 36px; height: 36px; border-width: 3px; border-color: #10b981; border-top-color: transparent; margin: 0 auto 16px auto;"></div>
          <p id="gep-loading-title" style="font-size: 16px; font-weight: 700; margin: 0 0 6px 0;">Varrendo todos os membros do grupo...</p>
          <p id="gep-loading-desc" style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">Grupo com ${totalExpected || 'muitos'} membros. Percorrendo a lista completa...</p>
          <div style="background: #e2e8f0; border-radius: 999px; height: 8px; width: 100%; max-width: 320px; margin: 0 auto; overflow: hidden;">
            <div id="gep-progress-bar" style="background: #10b981; height: 100%; width: 5%; transition: width 0.2s;"></div>
          </div>
          <p id="gep-progress-text" style="font-size: 12px; color: #10b981; font-weight: 600; margin: 8px 0 0 0;">Iniciando...</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('gep-btn-close').addEventListener('click', () => {
      abortExtraction = true;
      closeModal();
    });
  }

  function updateModalProgress(current, total, statusText) {
    const textEl = document.getElementById('gep-progress-text');
    const barEl = document.getElementById('gep-progress-bar');
    if (textEl) textEl.textContent = statusText || `${current} membros lidos...`;
    if (barEl && total > 0) {
      const pct = Math.min(100, Math.round((current / total) * 100));
      barEl.style.width = `${Math.max(5, pct)}%`;
    }
  }

  // RENDERIZAÇÃO DO MODAL DE RESULTADOS COM EXCLUSÃO E ENVIO DIRETO
  function renderModalResults(groupName, initialContacts, totalExpected) {
    let currentContacts = [...initialContacts];
    const selectedDigits = new Set();

    const overlay = document.getElementById('gep-modal-overlay');
    if (!overlay) return;

    const card = document.getElementById('gep-modal-card');

    function refreshView() {
      const validCount = currentContacts.filter(c => c.digits).length;
      const adminCount = currentContacts.filter(c => c.isAdmin).length;
      const memberCount = validCount - adminCount;

      card.innerHTML = `
        <div class="gep-header">
          <h2 class="gep-title">
            <span>${escapeHtml(groupName)}</span>
            <span class="gep-badge" style="background: #10b981; color: white;">${validCount} contatos</span>
          </h2>
          <button class="gep-close" id="gep-btn-close">&times;</button>
        </div>

        <div class="gep-body">
          <div class="gep-stats">
            <div class="gep-stat-box">
              <div class="gep-stat-value">${validCount}</div>
              <div class="gep-stat-label">Total Extraído</div>
            </div>
            <div class="gep-stat-box" style="border-color: ${adminCount > 0 ? '#f59e0b' : '#e2e8f0'};">
              <div class="gep-stat-value" style="color: ${adminCount > 0 ? '#d97706' : '#10b981'};">${adminCount}</div>
              <div class="gep-stat-label">Administradores</div>
            </div>
            <div class="gep-stat-box">
              <div class="gep-stat-value" style="color: #6366f1;">${memberCount}</div>
              <div class="gep-stat-label">Membros Comuns</div>
            </div>
          </div>

          ${adminCount > 0 ? `
            <div class="gep-admin-alert">
              <div>
                <strong>🛡️ ${adminCount} Administrador(es) detectados:</strong> Recomendado excluir para evitar bloqueios ao disparar convites.
              </div>
              <button class="gep-btn gep-btn-danger" id="gep-btn-del-admins" style="font-size: 11px; padding: 6px 12px;">
                Excluir Admins (${adminCount})
              </button>
            </div>
          ` : ''}

          <div id="gep-bulk-box" class="gep-bulk-bar" style="display: ${selectedDigits.size > 0 ? 'flex' : 'none'};">
            <span><strong>${selectedDigits.size}</strong> contato(s) selecionado(s)</span>
            <div style="display: flex; gap: 8px;">
              <button class="gep-btn gep-btn-danger" id="gep-btn-del-selected" style="padding: 4px 10px; font-size: 11px;">
                🗑️ Excluir Selecionados (${selectedDigits.size})
              </button>
              <button class="gep-btn gep-btn-secondary" id="gep-btn-clear-selection" style="padding: 4px 10px; font-size: 11px;">
                Desmarcar
              </button>
            </div>
          </div>

          <input type="text" class="gep-search" id="gep-filter-input" placeholder="Buscar por nome ou telefone nos ${validCount} contatos..." />

          <div class="gep-table-wrap">
            <table class="gep-table" id="gep-contacts-table">
              <thead>
                <tr>
                  <th style="width: 30px; text-align: center;">
                    <input type="checkbox" id="gep-check-all" style="cursor: pointer;" title="Selecionar todos os visíveis" />
                  </th>
                  <th style="width: 35px;">#</th>
                  <th>Nome / Apelido</th>
                  <th>Telefone (com DDD)</th>
                  <th>Cargo</th>
                  <th style="width: 35px; text-align: center;">Excluir</th>
                </tr>
              </thead>
              <tbody id="gep-contacts-tbody">
                ${renderTableRows(currentContacts, selectedDigits)}
              </tbody>
            </table>
          </div>
        </div>

        <div class="gep-footer">
          <button class="gep-btn gep-btn-primary" id="gep-send-app-btn" style="padding: 10px 18px; font-size: 13px;">
            🚀 Ir Direto para o Sistema (localhost:5173)
          </button>
          <div class="gep-footer-right">
            <button class="gep-btn gep-btn-secondary" id="gep-copy-btn">
              📋 Copiar Telefones
            </button>
            <button class="gep-btn gep-btn-secondary" id="gep-csv-btn">
              📥 Baixar CSV
            </button>
            <button class="gep-btn gep-btn-accent" id="gep-excel-btn">
              📊 Excel (.xlsx)
            </button>
          </div>
        </div>
      `;

      // Eventos
      document.getElementById('gep-btn-close').addEventListener('click', closeModal);

      // Botão Excluir Admins
      const btnDelAdmins = document.getElementById('gep-btn-del-admins');
      if (btnDelAdmins) {
        btnDelAdmins.addEventListener('click', () => {
          const removed = currentContacts.filter(c => c.isAdmin).length;
          currentContacts = currentContacts.filter(c => !c.isAdmin);
          selectedDigits.clear();
          syncWithLocalApp(groupName, currentContacts, totalExpected);
          refreshView();
          alert(`🛡️ ${removed} administrador(es) removido(s) com sucesso!`);
        });
      }

      // Check all
      const checkAll = document.getElementById('gep-check-all');
      if (checkAll) {
        checkAll.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          const filterVal = (document.getElementById('gep-filter-input')?.value || '').toLowerCase();
          const visible = getVisibleContacts(filterVal);
          if (isChecked) {
            visible.forEach(c => selectedDigits.add(c.digits));
          } else {
            visible.forEach(c => selectedDigits.delete(c.digits));
          }
          refreshTableOnly();
        });
      }

      // Excluir selecionados
      const btnDelSelected = document.getElementById('gep-btn-del-selected');
      if (btnDelSelected) {
        btnDelSelected.addEventListener('click', () => {
          const count = selectedDigits.size;
          if (count === 0) return;
          currentContacts = currentContacts.filter(c => !selectedDigits.has(c.digits));
          selectedDigits.clear();
          syncWithLocalApp(groupName, currentContacts, totalExpected);
          refreshView();
          alert(`🗑️ ${count} contato(s) excluído(s) com sucesso!`);
        });
      }

      // Desmarcar
      const btnClearSel = document.getElementById('gep-btn-clear-selection');
      if (btnClearSel) {
        btnClearSel.addEventListener('click', () => {
          selectedDigits.clear();
          refreshTableOnly();
        });
      }

      // Busca
      const filterInput = document.getElementById('gep-filter-input');
      filterInput.addEventListener('input', () => {
        refreshTableOnly();
      });

      // ENVIAR PARA O SISTEMA E ABRIR
      document.getElementById('gep-send-app-btn').addEventListener('click', async () => {
        const btn = document.getElementById('gep-send-app-btn');
        btn.textContent = 'Enviando e Abrindo...';
        btn.style.opacity = '0.7';

        syncWithLocalApp(groupName, currentContacts, totalExpected);

        // Abre o sistema em nova aba
        window.open('http://localhost:5173/', '_blank');

        setTimeout(() => {
          btn.textContent = '🚀 Ir Direto para o Sistema (localhost:5173)';
          btn.style.opacity = '1';
        }, 1500);
      });

      // Copiar telefones
      document.getElementById('gep-copy-btn').addEventListener('click', () => {
        const phones = currentContacts.map((c) => c.formatted || c.digits).filter(Boolean).join('\n');
        navigator.clipboard.writeText(phones).then(() => {
          alert(`✅ ${currentContacts.length} telefones copiados para a área de transferência!`);
        });
      });

      // Baixar CSV / Excel
      document.getElementById('gep-csv-btn').addEventListener('click', () => {
        downloadCSV(groupName, currentContacts);
      });
      document.getElementById('gep-excel-btn').addEventListener('click', () => {
        downloadCSV(groupName, currentContacts);
      });

      bindRowEvents();
    }

    function getVisibleContacts(query) {
      if (!query) return currentContacts;
      return currentContacts.filter((c) =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.formatted && c.formatted.includes(query)) ||
        (c.digits && c.digits.includes(query))
      );
    }

    function refreshTableOnly() {
      const q = (document.getElementById('gep-filter-input')?.value || '').toLowerCase();
      const visible = getVisibleContacts(q);
      const tbody = document.getElementById('gep-contacts-tbody');
      if (tbody) {
        tbody.innerHTML = renderTableRows(visible, selectedDigits);
        bindRowEvents();
      }

      // Atualiza barra de bulk
      const bulkBox = document.getElementById('gep-bulk-box');
      if (bulkBox) {
        bulkBox.style.display = selectedDigits.size > 0 ? 'flex' : 'none';
        const span = bulkBox.querySelector('span');
        if (span) span.innerHTML = `<strong>${selectedDigits.size}</strong> contato(s) selecionado(s)`;
        const btn = document.getElementById('gep-btn-del-selected');
        if (btn) btn.textContent = `🗑️ Excluir Selecionados (${selectedDigits.size})`;
      }

      // Atualiza check-all
      const checkAll = document.getElementById('gep-check-all');
      if (checkAll && visible.length > 0) {
        checkAll.checked = visible.every(c => selectedDigits.has(c.digits));
      }
    }

    function bindRowEvents() {
      // Checkboxes individuais
      card.querySelectorAll('.gep-row-check').forEach(input => {
        input.addEventListener('change', (e) => {
          const digits = e.target.getAttribute('data-digits');
          if (e.target.checked) selectedDigits.add(digits);
          else selectedDigits.delete(digits);
          refreshTableOnly();
        });
      });

      // Exclusão individual
      card.querySelectorAll('.gep-row-del-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const digits = e.currentTarget.getAttribute('data-digits');
          currentContacts = currentContacts.filter(c => c.digits !== digits);
          selectedDigits.delete(digits);
          syncWithLocalApp(groupName, currentContacts, totalExpected);
          refreshView();
        });
      });
    }

    refreshView();
  }

  function renderTableRows(list, selectedDigits = new Set()) {
    if (list.length === 0) {
      return `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">Nenhum contato encontrado.</td></tr>`;
    }
    return list.slice(0, 150).map((c, i) => {
      const isChecked = selectedDigits.has(c.digits);
      return `
        <tr style="background: ${isChecked ? '#fee2e220' : 'transparent'};">
          <td style="text-align: center;">
            <input type="checkbox" class="gep-row-check" data-digits="${c.digits}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
          </td>
          <td style="color: #94a3b8; font-size: 11px;">${i + 1}</td>
          <td><strong>${escapeHtml(c.name || 'Sem nome')}</strong></td>
          <td><code>${escapeHtml(c.formatted || c.digits || '-')}</code></td>
          <td>${c.isAdmin ? '<span class="gep-badge" style="background: #fef3c7; color: #b45309; border-color: #fde68a;">Admin</span>' : '<span style="color: #64748b;">Membro</span>'}</td>
          <td style="text-align: center;">
            <button class="gep-row-del-btn" data-digits="${c.digits}" title="Excluir este contato">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + (list.length > 150 ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:10px;font-style:italic;">... e mais ${list.length - 150} contatos (todos inclusos no envio/download).</td></tr>` : '');
  }

  function downloadCSV(groupName, contacts) {
    const rows = [['Nome', 'Telefone', 'Telefone_Digitos', 'Administrador', 'Grupo']];
    for (const c of contacts) {
      rows.push([
        c.name || '',
        c.formatted || c.digits || '',
        c.digits || '',
        c.isAdmin ? 'Sim' : 'Não',
        groupName
      ]);
    }
    const csvContent = '\uFEFF' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_${slugify(groupName)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function closeModal() {
    const el = document.getElementById('gep-modal-overlay');
    if (el) el.remove();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(text) {
    return (text || 'grupo').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  setInterval(injectFloatingButton, 2000);
})();
