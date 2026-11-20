const fs = require('fs');
const path = require('path');
const os = require('os');

const downloadsDir = path.join(os.homedir(), 'Downloads');
const inputFile = path.join(downloadsDir, 'contatos_whatsapp_rei_da_promo_660_1_.csv');

if (!fs.existsSync(inputFile)) {
  console.log('Arquivo contatos_whatsapp_rei_da_promo_660_1_.csv não encontrado');
  process.exit(1);
}

const content = fs.readFileSync(inputFile, 'utf-8');
const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

const parsed = [];
for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split(';').map((p) => p.replace(/^"|"$/g, '').trim());
  if (parts.length >= 3) {
    const rawDigits = parts[2].replace(/\D/g, '');
    if (rawDigits.length >= 10 && rawDigits.length <= 13) {
      const ddd = rawDigits.startsWith('55') ? rawDigits.slice(2, 4) : rawDigits.slice(0, 2);
      const sub = rawDigits.startsWith('55') ? rawDigits.slice(4) : rawDigits.slice(2);
      parsed.push({
        index: i,
        ddd,
        sub,
        cleanDigits: rawDigits.startsWith('55') ? rawDigits : ('55' + rawDigits),
        nationalDigits: rawDigits.startsWith('55') ? rawDigits.slice(2) : rawDigits,
        isAdmin: parts[3] === 'Sim',
        group: 'REI DA PROMO #660',
      });
    }
  }
}

console.log('Contatos extraídos:', parsed.length);

const rowsCom55 = [['Nome', 'Telefone', 'Digitos', 'Administrador', 'Origem', 'Grupo_Destino']];
const rowsSem55 = [['Nome', 'Telefone', 'Digitos', 'Administrador', 'Origem', 'Grupo_Destino']];
const vcfCom55 = [];
const vcfSem55 = [];

parsed.forEach((p, idx) => {
  const name = 'Lead #' + String(idx + 1).padStart(3, '0') + ' (' + p.ddd + ')';
  const phoneCom55 = '+55 (' + p.ddd + ') ' + p.sub.slice(0, 5) + '-' + p.sub.slice(5);
  const phoneSem55 = '(' + p.ddd + ') ' + p.sub.slice(0, 5) + '-' + p.sub.slice(5);

  rowsCom55.push([name, phoneCom55, p.cleanDigits, p.isAdmin ? 'Sim' : 'Não', p.group, 'Grupo VIP']);
  rowsSem55.push([name, phoneSem55, p.nationalDigits, p.isAdmin ? 'Sim' : 'Não', p.group, 'Grupo VIP']);

  vcfCom55.push([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:' + name,
    'N:' + name + ';;;;',
    'TEL;TYPE=CELL,VOICE:+' + p.cleanDigits,
    'END:VCARD'
  ].join('\r\n'));

  vcfSem55.push([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:' + name,
    'N:' + name + ';;;;',
    'TEL;TYPE=CELL,VOICE:' + p.nationalDigits,
    'END:VCARD'
  ].join('\r\n'));
});

function toCSV(rows) {
  return '\uFEFF' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
}

fs.writeFileSync(path.join(downloadsDir, 'contatos_rei_da_promo_660_com_55.csv'), toCSV(rowsCom55), 'utf-8');
fs.writeFileSync(path.join(downloadsDir, 'contatos_rei_da_promo_660_sem_55.csv'), toCSV(rowsSem55), 'utf-8');
fs.writeFileSync(path.join(downloadsDir, 'contatos_rei_da_promo_660_com_55.vcf'), vcfCom55.join('\r\n'), 'utf-8');
fs.writeFileSync(path.join(downloadsDir, 'contatos_rei_da_promo_660_sem_55.vcf'), vcfSem55.join('\r\n'), 'utf-8');

// Atualiza também o arquivo ativo no editor do usuário para os nomes ficarem certos imediatamente!
fs.writeFileSync(inputFile, toCSV(rowsCom55), 'utf-8');

console.log('✅ Arquivos gerados com sucesso na pasta Downloads!');
