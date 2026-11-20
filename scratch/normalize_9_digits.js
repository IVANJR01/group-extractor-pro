const fs = require('fs');

const path = 'C:\\Users\\ivanj\\Downloads\\contatos_colagem_whatsapp.csv';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split(/\r?\n/).filter(Boolean);

const validDDDs = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

let totalProcessed = 0;
let totalFixedWith9 = 0;
let totalAlreadyWith9 = 0;
let invalid = 0;

const normalizedContacts = [];
const uniqueMap = new Set();

for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split(';').map(p => p.replace(/^"|"$/g, '').trim());
  let raw = (parts[2] || parts[1] || '').replace(/\D/g, '');
  if (!raw) continue;

  let local = raw;
  if (local.startsWith('55') && (local.length === 12 || local.length === 13 || local.length === 10 || local.length === 11)) {
    local = local.slice(2);
  }

  // DDD
  const ddd = parseInt(local.slice(0, 2), 10);
  if (!validDDDs.has(ddd)) {
    invalid++;
    continue;
  }

  const dddStr = String(ddd);
  const rest = local.slice(2);

  let finalNumber = '';

  if (rest.length === 8) {
    // Insere o nono dígito (9)
    finalNumber = `55${dddStr}9${rest}`;
    totalFixedWith9++;
  } else if (rest.length === 9) {
    if (rest.startsWith('9')) {
      finalNumber = `55${dddStr}${rest}`;
      totalAlreadyWith9++;
    } else {
      // Se não começa com 9 mas tem 9 digitos, pode ser erro
      finalNumber = `55${dddStr}${rest}`;
    }
  } else {
    invalid++;
    continue;
  }

  if (finalNumber && !uniqueMap.has(finalNumber)) {
    uniqueMap.add(finalNumber);
    const name = parts[0] && !/^(não|nao|sim|admin|membro|\d+)$/i.test(parts[0]) ? parts[0] : '';
    normalizedContacts.push({
      name,
      digits: finalNumber,
      ddd: dddStr,
      formatted: `+55 (${dddStr}) ${finalNumber.slice(4, 9)}-${finalNumber.slice(9)}`
    });
    totalProcessed++;
  }
}

console.log('Resultados da normalização com Nono Dígito:');
console.log('- Total únicos válidos prontos:', totalProcessed);
console.log('- Contatos que precisavam do 9 e foram CORRIGIDOS:', totalFixedWith9);
console.log('- Contatos que já tinham o 9:', totalAlreadyWith9);
console.log('- Números inválidos descartados:', invalid);
console.log('\nPrimeiros 10 corrigidos com 9:');
console.log(normalizedContacts.slice(0, 10));
