export interface SavedContact {
  name: string;
  phone: string;
  digits: string;
  isAdmin: boolean;
  invited?: boolean;
}

export interface AdminAccount {
  id: string;
  name: string;
  phone?: string;
  active: boolean;
}

export interface MultiAdminBatch {
  id: string;
  dayIndex: number;
  dayLabel: string;
  adminId: string;
  adminName: string;
  contacts: SavedContact[];
  completed: boolean;
  completedAt?: string;
}

export interface MultiAdminSchedule {
  accountsCount: number;
  dailyLimit: number;
  accounts: AdminAccount[];
  batches: MultiAdminBatch[];
  lastGenerated: string;
}

export interface ExtractedGroupSession {
  groupName: string;
  totalContacts: number;
  contacts: SavedContact[];
  destinationGroup?: {
    name: string;
    inviteUrl: string;
  };
  multiAdminSchedule?: MultiAdminSchedule;
  lastUpdated: string;
}

const STORAGE_KEY = 'gep_active_extraction_session';

export function getActiveSession(): ExtractedGroupSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ExtractedGroupSession;
  } catch {
    return null;
  }
}

export function saveActiveSession(session: ExtractedGroupSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    console.error('Erro ao salvar sessão local:', e);
  }
}

export function updateDestinationGroup(name: string, inviteUrl: string): ExtractedGroupSession | null {
  const current = getActiveSession();
  if (!current) {
    const fallback: ExtractedGroupSession = {
      groupName: 'Grupo Extraído',
      totalContacts: 0,
      contacts: [],
      destinationGroup: { name, inviteUrl },
      lastUpdated: new Date().toISOString(),
    };
    saveActiveSession(fallback);
    return fallback;
  }
  current.destinationGroup = { name, inviteUrl };
  current.lastUpdated = new Date().toISOString();
  saveActiveSession(current);
  return current;
}

export function markContactInvited(digits: string, invited: boolean = true): void {
  const current = getActiveSession();
  if (!current) return;
  const c = current.contacts.find((item) => item.digits === digits);
  if (c) {
    c.invited = invited;
    saveActiveSession(current);
  }
}

export function deleteContacts(digitsList: string[]): ExtractedGroupSession | null {
  const current = getActiveSession();
  if (!current) return null;
  const set = new Set(digitsList);
  current.contacts = current.contacts.filter((c) => !set.has(c.digits));
  current.totalContacts = current.contacts.length;
  current.lastUpdated = new Date().toISOString();
  saveActiveSession(current);
  return current;
}

export function deleteAdmins(): ExtractedGroupSession | null {
  const current = getActiveSession();
  if (!current) return null;
  current.contacts = current.contacts.filter((c) => !c.isAdmin);
  current.totalContacts = current.contacts.length;
  current.lastUpdated = new Date().toISOString();
  saveActiveSession(current);
  return current;
}

export function deleteSingleContact(digits: string): ExtractedGroupSession | null {
  return deleteContacts([digits]);
}

/**
 * DETECTA E EXCLUI NÚMEROS REPETIDOS AUTOMATICAMENTE
 * Garante que nenhum telefone apareça mais de uma vez na lista.
 */
export function removeDuplicateContacts(): { removedCount: number; session: ExtractedGroupSession | null } {
  const session = getActiveSession();
  if (!session || session.contacts.length === 0) return { removedCount: 0, session: null };

  const seen = new Set<string>();
  const unique: SavedContact[] = [];
  let duplicates = 0;

  for (const c of session.contacts) {
    if (!seen.has(c.digits)) {
      seen.add(c.digits);
      unique.push(c);
    } else {
      duplicates++;
    }
  }

  session.contacts = unique;
  session.totalContacts = unique.length;
  session.lastUpdated = new Date().toISOString();
  saveActiveSession(session);
  return { removedCount: duplicates, session };
}

/**
 * GERA ARQUIVO VCARD (VCF) PARA IMPORTAÇÃO DIRETA NA AGENDA DO CELULAR
 * Cada contato importado na agenda aparece instantaneamente na lista
 * "Adicionar Participantes" do WhatsApp do administrador.
 */
export function generateVCardString(contacts: { name?: string; digits: string }[]): string {
  return contacts
    .map((c, i) => {
      const name = c.name?.trim() ? c.name.trim() : `Lead ${i + 1} (${c.digits.slice(-4)})`;
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name}`,
        `N:${name};;;;`,
        `TEL;TYPE=CELL,VOICE:+${c.digits}`,
        'END:VCARD',
      ].join('\r\n');
    })
    .join('\r\n');
}

export function downloadVCardFile(fileName: string, contacts: { name?: string; digits: string }[]): void {
  const content = generateVCardString(contacts);
  const blob = new Blob([content], { type: 'text/vcard;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * GERA O CRONOGRAMA DE ADIÇÃO ENTRE 6 CONTAS WHATSAPP ADMIN
 * Distribui a lista de contatos em lotes diários de 20 contatos por número.
 * Cada número recebe contatos 100% únicos (sem repetições).
 */
export function generateMultiAdminSchedule(
  accountsCount: number = 6,
  dailyLimit: number = 20,
  customAccountNames: string[] = []
): ExtractedGroupSession | null {
  const session = getActiveSession();
  if (!session || session.contacts.length === 0) return null;

  // Filtra apenas membros comuns (sem administradores do grupo de origem)
  // E garante que não haja números duplicados
  const seen = new Set<string>();
  const eligibleContacts: SavedContact[] = [];

  for (const c of session.contacts) {
    if (!c.isAdmin && !seen.has(c.digits)) {
      seen.add(c.digits);
      eligibleContacts.push(c);
    }
  }

  const defaultLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const accounts: AdminAccount[] = Array.from({ length: accountsCount }, (_, idx) => {
    const letter = defaultLetters[idx] || String(idx + 1);
    return {
      id: `admin-${letter.toLowerCase()}`,
      name: customAccountNames[idx] || `Número ${letter} (WhatsApp Admin)`,
      active: true,
    };
  });

  const activeAccounts = accounts.filter((a) => a.active);
  const batches: MultiAdminBatch[] = [];

  let contactIdx = 0;
  let day = 1;

  while (contactIdx < eligibleContacts.length) {
    const dayLabel = `Dia ${day}`;
    let addedInDay = false;

    for (const acc of activeAccounts) {
      if (contactIdx >= eligibleContacts.length) break;

      const batchContacts = eligibleContacts.slice(contactIdx, contactIdx + dailyLimit);
      contactIdx += batchContacts.length;
      addedInDay = true;

      batches.push({
        id: `batch-d${day}-${acc.id}`,
        dayIndex: day,
        dayLabel,
        adminId: acc.id,
        adminName: acc.name,
        contacts: batchContacts,
        completed: false,
      });
    }

    if (!addedInDay) break;
    day++;
  }

  const schedule: MultiAdminSchedule = {
    accountsCount,
    dailyLimit,
    accounts,
    batches,
    lastGenerated: new Date().toISOString(),
  };

  session.multiAdminSchedule = schedule;
  session.lastUpdated = new Date().toISOString();
  saveActiveSession(session);
  return session;
}

export function toggleBatchCompleted(batchId: string, completed: boolean): ExtractedGroupSession | null {
  const session = getActiveSession();
  if (!session || !session.multiAdminSchedule) return null;

  const b = session.multiAdminSchedule.batches.find((item) => item.id === batchId);
  if (b) {
    b.completed = completed;
    b.completedAt = completed ? new Date().toISOString() : undefined;
    session.lastUpdated = new Date().toISOString();
    saveActiveSession(session);
  }
  return session;
}
