// Aplica o tema antes de desenhar a tela (arquivo externo para permitir CSP sem 'unsafe-inline').
try {
  var t = localStorage.getItem('gep-theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
