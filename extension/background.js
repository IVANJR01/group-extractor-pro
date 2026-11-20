// Group Extractor Pro - Background Service Worker
// Responsável por contornar o Content Security Policy (CSP) do WhatsApp Web
// e enviar os contatos extraídos diretamente para a API local (localhost:5173).

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync_with_local_app') {
    const payload = request.data || {};
    
    fetch('http://localhost:5173/api/extracted-contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(err => {
        // Tenta fallback com 127.0.0.1
        fetch('http://127.0.0.1:5173/api/extracted-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(res => res.json())
          .then(data => sendResponse({ success: true, data }))
          .catch(err2 => sendResponse({ success: false, error: err2.message }));
      });

    return true; // Indica resposta assíncrona
  }
});
