document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const btnExtract = document.getElementById('btn-extract');
  const btnOpenWA = document.getElementById('btn-open-wa');

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isWhatsApp = activeTab?.url?.includes('web.whatsapp.com');

  if (isWhatsApp) {
    statusDot.classList.add('active');
    statusText.textContent = 'Conectado ao WhatsApp Web';
    btnExtract.disabled = false;
  } else {
    statusDot.classList.remove('active');
    statusText.textContent = 'WhatsApp Web não está ativo nesta aba';
  }

  btnExtract.addEventListener('click', async () => {
    if (!isWhatsApp) {
      chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      return;
    }
    chrome.tabs.sendMessage(activeTab.id, { action: 'extract_now' }, () => {
      window.close();
    });
  });

  btnOpenWA.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://web.whatsapp.com' });
  });
});
