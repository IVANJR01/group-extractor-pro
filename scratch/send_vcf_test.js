const fs = require('fs');

async function sendVcfToMe() {
  try {
    const res = await fetch('http://localhost:5173/api/robot/status');
    const data = await res.json();
    console.log('Status WhatsApp 1:', data.chips[0]);

    if (data.chips[0]?.status === 'connected') {
      console.log('WhatsApp 1 está conectado! Enviando VCF via endpoint dedicado...');
    } else {
      console.log('WhatsApp 1 não está conectado no momento.');
    }
  } catch (err) {
    console.error('Erro:', err.message);
  }
}
sendVcfToMe();
