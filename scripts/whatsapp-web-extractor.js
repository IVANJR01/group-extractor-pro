/**
 * ====================================================================
 * GROUP EXTRACTOR PRO - SCRIPT PARA WHATSAPP WEB (CONSOLE DEVTOOLS v2.2)
 * Extração profunda + Exclusão de Admins + Envio Direto ao Sistema
 * ====================================================================
 */

(async function () {
  'use strict';

  console.log('%c[Group Extractor Pro v2.2]%c Iniciando extração profunda do grupo...', 'color: #10b981; font-weight: bold;', 'color: inherit;');

  // 1. Nome do Grupo
  function getGroupName() {
    const drawer = document.querySelector('div[data-testid="chat-info-drawer"], div[tabindex="-1"]');
    if (drawer) {
      const candidates = drawer.querySelectorAll('h2, span[dir="auto"], div[role="region"] span');
      for (const el of candidates) {
        const text = (el.getAttribute('title') || el.textContent || '').trim();
        if (text && !text.includes('Dados do grupo') && !text.includes('membros') && text.length > 2) {
          return text;
        }
      }
    }

    const header = document.querySelector('#main header, div[data-testid="conversation-header"], header');
    if (header) {
      const titleEl = header.querySelector('div[role="button"] span[title], span[data-testid="conversation-info-header-chat-title"], span[title]');
      if (titleEl) {
        const val = titleEl.getAttribute('title') || titleEl.textContent;
        if (val && !val.includes(',') && !val.includes('+')) return val.trim();
      }
      const spans = header.querySelectorAll('span[dir="auto"]');
      for (const s of spans) {
        const t = (s.getAttribute('title') || s.textContent || '').trim();
        if (t && !t.includes(',') && !t.includes('+') && !t.toLowerCase().includes('online') && t.length > 1) {
          return t;
        }
      }
    }
    return 'Grupo WhatsApp';
  }

  // 2. Total esperado de membros
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

  function cleanPhone(raw) {
    if (!raw) return '';
    return String(raw).replace(/@.*$/, '').replace(/\D/g, '');
  }

  function formatPhone(digits) {
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) {
      const ddd = digits.slice(2, 4);
      const rest = digits.slice(4);
      return rest.length === 9 ? `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}` : `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    if (digits.length >= 10) return `+${digits}`;
    return digits;
  }

  function cleanName(name, digits) {
    if (!name) return '';
    let n = name.trim();
    if (n.startsWith('~')) n = n.slice(1).trim();
    if (cleanPhone(n) === digits) return '';
    return n;
  }

  const groupName = getGroupName();
  const totalExpected = getExpectedMembersCount();
  console.log(`[Group Extractor Pro] Grupo identificado: "${groupName}" com ${totalExpected || 'muitos'} membros.`);

  let contactsMap = new Map();

  // ETAPA 1: Tenta extração via React Fiber no Console (Acesso direto a memória)
  try {
    const elements = [
      document.querySelector('#main header'),
      document.querySelector('div[data-testid="chat-info-drawer"]'),
      document.querySelector('#main'),
      document.querySelector('#app')
    ].filter(Boolean);

    for (const el of elements) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fiberKey) continue;

      let curr = el[fiberKey];
      let depth = 0;
      while (curr && depth < 80) {
        const p = curr.memoizedProps;
        const gm = p?.groupMetadata || p?.chat?.groupMetadata;
        if (gm) {
          const raw = gm.participants?._models || gm.participants?.models || (Array.isArray(gm.participants) ? gm.participants : null);
          if (raw && raw.length > 0) {
            for (const item of raw) {
              let rawPhone = '';
              if (item.id) rawPhone = typeof item.id === 'object' ? (item.id.user || item.id._serialized || '') : item.id;
              if (!rawPhone && item.user) rawPhone = item.user;
              if (!rawPhone && item.phoneNumber) rawPhone = item.phoneNumber;

              const digits = cleanPhone(rawPhone);
              if (digits.length >= 8 && digits.length <= 15) {
                const isAdmin = Boolean(item.isAdmin || item.isSuperAdmin || item.role === 'admin');
                const c = item.contact || {};
                const name = cleanName(c.name || c.pushname || c.formattedName || item.displayName || item.name || '', digits);
                contactsMap.set(digits, { name, rawPhone: digits, digits, formatted: formatPhone(digits), isAdmin });
              }
            }
            if (contactsMap.size > 0) break;
          }
        }
        curr = curr.return;
        depth++;
      }
      if (contactsMap.size > 0) break;
    }
  } catch (e) {
    console.warn('Fiber lookup failed:', e);
  }

  // ETAPA 2: Se não pegou todos via Fiber, usa a rolagem automática do painel lateral
  if (contactsMap.size < (totalExpected || 30)) {
    console.log(`[Group Extractor Pro] Percorrendo lista visual de membros...`);
    const header = document.querySelector('#main header, div[data-testid="conversation-header"], header');
    let drawer = document.querySelector('div[data-testid="chat-info-drawer"], div[tabindex="-1"]');
    if (!drawer && header) {
      (header.querySelector('div[role="button"]') || header).click();
      await new Promise(r => setTimeout(r, 600));
      drawer = document.querySelector('div[data-testid="chat-info-drawer"], div[tabindex="-1"]');
    }

    if (drawer) {
      let drawerScroll = drawer;
      for (const d of drawer.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight) {
          drawerScroll = d;
          break;
        }
      }

      // Procurar e clicar em "Ver todos"
      for (let s = 0; s < 8; s++) {
        const buttons = drawer.querySelectorAll('div[role="button"], span[role="button"], button');
        for (const btn of buttons) {
          const text = btn.textContent || '';
          if (/ver todos|ver tudo|membros/i.test(text) && /\d+/.test(text)) {
            btn.click();
            await new Promise(r => setTimeout(r, 500));
            break;
          }
        }
        drawerScroll.scrollTop += 600;
        await new Promise(r => setTimeout(r, 150));
      }

      const activeModal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]') || drawer;
      let listScroll = activeModal;
      for (const d of activeModal.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight) {
          listScroll = d;
          break;
        }
      }

      let noNewCount = 0;
      let prevCount = 0;

      for (let i = 0; i < 200; i++) {
        const rows = (activeModal || drawer).querySelectorAll('div[role="listitem"], div[data-testid="cell-frame-container"]');
        for (const row of rows) {
          const text = row.textContent || '';
          const isAdmin = /admin/i.test(text);
          const phoneMatch = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/);
          let digits = phoneMatch ? cleanPhone(phoneMatch[0]) : '';

          let name = '';
          const titleNodes = row.querySelectorAll('span[title], span[dir="auto"]');
          for (const tn of titleNodes) {
            const val = (tn.getAttribute('title') || tn.textContent || '').trim();
            if (val && !val.includes(phoneMatch ? phoneMatch[0] : '___')) {
              name = cleanName(val, digits);
              if (name) break;
            }
          }

          if (digits.length >= 8 && digits.length <= 15) {
            if (!contactsMap.has(digits)) {
              contactsMap.set(digits, { name, rawPhone: phoneMatch ? phoneMatch[0] : digits, digits, formatted: formatPhone(digits), isAdmin });
            } else if (name && !contactsMap.get(digits).name) {
              contactsMap.get(digits).name = name;
            }
          }
        }

        if (totalExpected > 0 && contactsMap.size >= totalExpected) break;

        if (contactsMap.size === prevCount) {
          noNewCount++;
          if (noNewCount >= 8) break;
        } else {
          noNewCount = 0;
          prevCount = contactsMap.size;
        }

        listScroll.scrollTop += 500;
        await new Promise(r => setTimeout(r, 120));
      }
    }
  }

  // ETAPA 3: Fallback de cabeçalho
  if (contactsMap.size === 0) {
    const header = document.querySelector('#main header');
    if (header) {
      for (const span of header.querySelectorAll('span[title]')) {
        const t = span.getAttribute('title') || '';
        if (t.includes(',') && (t.includes('+') || /\d{4}/.test(t))) {
          for (const item of t.split(/[,;]+/)) {
            const digits = cleanPhone(item);
            if (digits.length >= 8 && digits.length <= 15) {
              contactsMap.set(digits, { name: '', rawPhone: item, digits, formatted: formatPhone(digits), isAdmin: false });
            }
          }
        }
      }
    }
  }

  let contacts = Array.from(contactsMap.values());

  if (contacts.length === 0) {
    alert(`⚠️ Não foi possível extrair contatos do grupo "${groupName}". Abra os "Dados do grupo" e tente novamente.`);
    return;
  }

  console.log(`%c[Group Extractor Pro]%c Sucesso! ${contacts.length} participantes extraídos de "${groupName}".`, 'color: #10b981; font-weight: bold;', 'color: inherit;');

  // Sincroniza em segundo plano
  function syncApp(list) {
    try {
      fetch('http://localhost:5173/api/extracted-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName, contacts: list, totalExpected })
      }).catch(() => {});
    } catch (e) {}
  }
  syncApp(contacts);

  // Exibir Modal com resultados
  const oldModal = document.getElementById('gep-console-modal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.id = 'gep-console-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);
    z-index: 999999; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const selectedDigits = new Set();

  function renderConsoleModal() {
    const validCount = contacts.length;
    const adminCount = contacts.filter(c => c.isAdmin).length;
    const memberCount = validCount - adminCount;

    modal.innerHTML = `
      <div style="background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 16px; width: 720px; max-width: 92vw; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
        <div style="padding: 16px 22px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            ⚡ ${groupName}
            <span style="background: #065f46; color: #6ee7b7; font-size: 11px; padding: 2px 10px; border-radius: 999px;">${validCount} contatos</span>
          </h2>
          <button id="gep-cm-close" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
        </div>

        <div style="padding: 18px 22px; overflow-y: auto; flex: 1;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; text-align: center;">
            <div style="background: #0f172a; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-size: 20px; font-weight: 700; color: #10b981;">${validCount}</div>
              <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">Total Extraído</div>
            </div>
            <div style="background: #0f172a; padding: 10px; border-radius: 8px; border: 1px solid ${adminCount > 0 ? '#b45309' : '#334155'};">
              <div style="font-size: 20px; font-weight: 700; color: ${adminCount > 0 ? '#f59e0b' : '#10b981'};">${adminCount}</div>
              <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">Administradores</div>
            </div>
            <div style="background: #0f172a; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-size: 20px; font-weight: 700; color: #60a5fa;">${memberCount}</div>
              <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">Membros Comuns</div>
            </div>
          </div>

          ${adminCount > 0 ? `
            <div style="background: #78350f25; border: 1px solid #b45309; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #fde68a;">
              <div><strong>🛡️ ${adminCount} Administrador(es) detectados:</strong> Exclua para evitar denúncias ou bloqueios.</div>
              <button id="gep-cm-del-admins" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 11px;">
                Excluir Admins (${adminCount})
              </button>
            </div>
          ` : ''}

          <div id="gep-cm-bulk" style="display: ${selectedDigits.size > 0 ? 'flex' : 'none'}; justify-content: space-between; align-items: center; background: #7f1d1d25; border: 1px solid #991b1b; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #fca5a5;">
            <span><strong>${selectedDigits.size}</strong> contato(s) selecionado(s)</span>
            <div style="display: flex; gap: 8px;">
              <button id="gep-cm-del-selected" style="background: #dc2626; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 11px;">
                🗑️ Excluir Selecionados
              </button>
              <button id="gep-cm-clear-sel" style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">
                Desmarcar
              </button>
            </div>
          </div>

          <input type="text" id="gep-cm-search" placeholder="Buscar por nome ou telefone..." style="width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #334155; color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 10px; outline: none;" />

          <div style="border: 1px solid #334155; border-radius: 8px; max-height: 250px; overflow-y: auto; background: #0f172a;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
              <thead>
                <tr style="background: #1e293b; color: #94a3b8; position: sticky; top: 0;">
                  <th style="padding: 6px 10px; width: 30px; text-align: center;">
                    <input type="checkbox" id="gep-cm-check-all" style="cursor: pointer;" />
                  </th>
                  <th style="padding: 6px 10px; width: 35px;">#</th>
                  <th style="padding: 6px 10px;">Nome / Apelido</th>
                  <th style="padding: 6px 10px;">Telefone</th>
                  <th style="padding: 6px 10px;">Tipo</th>
                  <th style="padding: 6px 10px; width: 35px; text-align: center;">Ação</th>
                </tr>
              </thead>
              <tbody id="gep-cm-tbody">
                ${renderConsoleRows(contacts, selectedDigits)}
              </tbody>
            </table>
          </div>
        </div>

        <div style="padding: 14px 22px; border-top: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button id="gep-cm-send" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px;">
            🚀 Ir Direto para o Sistema (localhost:5173)
          </button>
          <div style="display: flex; gap: 8px;">
            <button id="gep-cm-copy" style="background: #334155; color: #f8fafc; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;">
              📋 Copiar
            </button>
            <button id="gep-cm-csv" style="background: #334155; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;">
              📥 CSV
            </button>
            <button id="gep-cm-excel" style="background: #2563eb; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;">
              📊 Excel
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('gep-cm-close').onclick = () => modal.remove();

    const btnDelAdmins = document.getElementById('gep-cm-del-admins');
    if (btnDelAdmins) {
      btnDelAdmins.onclick = () => {
        const removed = contacts.filter(c => c.isAdmin).length;
        contacts = contacts.filter(c => !c.isAdmin);
        selectedDigits.clear();
        syncApp(contacts);
        renderConsoleModal();
        alert(`🛡️ ${removed} administradores excluídos com sucesso!`);
      };
    }

    const btnDelSelected = document.getElementById('gep-cm-del-selected');
    if (btnDelSelected) {
      btnDelSelected.onclick = () => {
        const count = selectedDigits.size;
        contacts = contacts.filter(c => !selectedDigits.has(c.digits));
        selectedDigits.clear();
        syncApp(contacts);
        renderConsoleModal();
        alert(`🗑️ ${count} contatos excluídos!`);
      };
    }

    const btnClearSel = document.getElementById('gep-cm-clear-sel');
    if (btnClearSel) {
      btnClearSel.onclick = () => {
        selectedDigits.clear();
        refreshConsoleTable();
      };
    }

    const checkAll = document.getElementById('gep-cm-check-all');
    if (checkAll) {
      checkAll.onchange = (e) => {
        const q = (document.getElementById('gep-cm-search')?.value || '').toLowerCase();
        const vis = filterConsoleList(q);
        if (e.target.checked) vis.forEach(c => selectedDigits.add(c.digits));
        else vis.forEach(c => selectedDigits.delete(c.digits));
        refreshConsoleTable();
      };
    }

    const searchInput = document.getElementById('gep-cm-search');
    searchInput.oninput = () => refreshConsoleTable();

    document.getElementById('gep-cm-send').onclick = async () => {
      const btn = document.getElementById('gep-cm-send');
      btn.textContent = 'Enviando e Abrindo...';
      syncApp(contacts);
      window.open('http://localhost:5173/', '_blank');
      setTimeout(() => {
        btn.textContent = '🚀 Ir Direto para o Sistema (localhost:5173)';
      }, 1500);
    };

    document.getElementById('gep-cm-copy').onclick = () => {
      const text = contacts.map((c) => c.formatted || c.digits).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        alert(`✅ ${contacts.length} telefones copiados para a área de transferência!`);
      });
    };

    document.getElementById('gep-cm-csv').onclick = exportCSV;
    document.getElementById('gep-cm-excel').onclick = exportCSV;

    bindConsoleRowEvents();
  }

  function filterConsoleList(q) {
    if (!q) return contacts;
    return contacts.filter(c => (c.name && c.name.toLowerCase().includes(q)) || c.phone?.includes(q) || c.digits.includes(q));
  }

  function refreshConsoleTable() {
    const q = (document.getElementById('gep-cm-search')?.value || '').toLowerCase();
    const vis = filterConsoleList(q);
    const tbody = document.getElementById('gep-cm-tbody');
    if (tbody) {
      tbody.innerHTML = renderConsoleRows(vis, selectedDigits);
      bindConsoleRowEvents();
    }
    const bulk = document.getElementById('gep-cm-bulk');
    if (bulk) {
      bulk.style.display = selectedDigits.size > 0 ? 'flex' : 'none';
      const sp = bulk.querySelector('span');
      if (sp) sp.innerHTML = `<strong>${selectedDigits.size}</strong> contato(s) selecionado(s)`;
    }
    const checkAll = document.getElementById('gep-cm-check-all');
    if (checkAll && vis.length > 0) {
      checkAll.checked = vis.every(c => selectedDigits.has(c.digits));
    }
  }

  function bindConsoleRowEvents() {
    modal.querySelectorAll('.gep-cm-row-chk').forEach(chk => {
      chk.onchange = (e) => {
        const d = e.target.getAttribute('data-digits');
        if (e.target.checked) selectedDigits.add(d);
        else selectedDigits.delete(d);
        refreshConsoleTable();
      };
    });

    modal.querySelectorAll('.gep-cm-row-del').forEach(btn => {
      btn.onclick = (e) => {
        const d = e.currentTarget.getAttribute('data-digits');
        contacts = contacts.filter(c => c.digits !== d);
        selectedDigits.delete(d);
        syncApp(contacts);
        renderConsoleModal();
      };
    });
  }

  function renderConsoleRows(list, sel = new Set()) {
    if (list.length === 0) return `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">Nenhum contato encontrado.</td></tr>`;
    return list.slice(0, 150).map((c, i) => {
      const isChecked = sel.has(c.digits);
      return `
        <tr style="border-top: 1px solid #1e293b; background: ${isChecked ? '#7f1d1d20' : 'transparent'};">
          <td style="padding: 6px 10px; text-align: center;">
            <input type="checkbox" class="gep-cm-row-chk" data-digits="${c.digits}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
          </td>
          <td style="padding: 6px 10px; color: #64748b;">${i + 1}</td>
          <td style="padding: 6px 10px; font-weight: 600;">${c.name || 'Sem nome'}</td>
          <td style="padding: 6px 10px; font-family: monospace;">${c.formatted || c.digits}</td>
          <td style="padding: 6px 10px;">${c.isAdmin ? '<span style="background: #78350f; color: #fde68a; font-size: 10px; padding: 2px 6px; border-radius: 4px;">Admin</span>' : '<span style="color: #64748b;">Membro</span>'}</td>
          <td style="padding: 6px 10px; text-align: center;">
            <button class="gep-cm-row-del" data-digits="${c.digits}" style="background: none; border: none; cursor: pointer; color: #94a3b8;" title="Excluir">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + (list.length > 150 ? `<tr><td colspan="6" style="text-align:center;padding:10px;color:#94a3b8;font-style:italic;">... e mais ${list.length - 150} contatos (todos inclusos no envio/download).</td></tr>` : '');
  }

  function exportCSV() {
    const rows = [['Nome', 'Telefone', 'Digitos', 'Administrador', 'Grupo']];
    for (const c of contacts) {
      rows.push([c.name || '', c.formatted || c.digits, c.digits, c.isAdmin ? 'Sim' : 'Não', groupName]);
    }
    const csv = '\uFEFF' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  document.body.appendChild(modal);
  renderConsoleModal();
})();
